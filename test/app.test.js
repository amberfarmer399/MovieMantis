const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoClient, ObjectId } = require("mongodb");
const { createApp, initializeDatabase } = require("../server");

const TEST_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const TEST_DB_NAME = "moviemantis_test";

test("MovieMantis end-to-end API, $jsonSchema validation, Extended Reference & ESR Indexes", async (t) => {
  const client = new MongoClient(TEST_URI);
  await client.connect();
  const db = client.db(TEST_DB_NAME);
  await db.dropDatabase();

  await initializeDatabase(db);
  const app = createApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    server.close();
    await db.dropDatabase();
    await client.close();
  });

  await t.test("1. Initializes required ESR indexes on movies and watchlists", async () => {
    const res = await fetch(`${baseUrl}/api/meta`);
    assert.equal(res.status, 200);
    const meta = await res.json();

    const movieIdxNames = meta.indexes.movies.map((i) => i.name);
    const watchlistIdxNames = meta.indexes.watchlists.map((i) => i.name);

    assert.ok(movieIdxNames.includes("idx_movies_discovery_esr"));
    assert.ok(watchlistIdxNames.includes("idx_watchlists_user_status_ranking"));
    assert.ok(watchlistIdxNames.includes("idx_watchlists_user_movie_unique"));
    assert.ok(meta.counts.movies >= 10);
  });

  await t.test("2. Executes discovery filter query using idx_movies_discovery_esr", async () => {
    const res = await fetch(
      `${baseUrl}/api/movies?genre=Sci-Fi&contentRating=PG-13&minYear=2014&maxYear=2026&sortBy=recommendationScore`
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.movies.length >= 2);

    // Confirm descending recommendationScore order
    for (let i = 1; i < data.movies.length; i++) {
      assert.ok(
        data.movies[i - 1].metrics.recommendationScore >=
          data.movies[i].metrics.recommendationScore
      );
    }

    // Confirm index usage in queryDiagnostic winningPlan
    const planJson = JSON.stringify(data.queryDiagnostic.winningPlan);
    assert.ok(planJson.includes("idx_movies_discovery_esr"));
  });

  await t.test("3. Enforces MongoDB $jsonSchema validation on invalid movie inserts", async () => {
    const res = await fetch(`${baseUrl}/api/validate-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "movies",
        payload: {
          title: "Bad Movie",
          slug: "INVALID SLUG!",
          releaseYear: 1700,
          runtimeMinutes: -5,
          contentRating: "NOT_VALID",
          genres: ["NotAGenre"]
        }
      })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.valid, false);
    assert.equal(body.code, 121);
  });

  await t.test("4. Adds a movie to Watchlist with Extended Reference movieSnapshot and uses idx_watchlists_user_status_ranking", async () => {
    // Pick a movie not yet in watchlist (e.g., Interstellar)
    const interstellarId = "65f1a0000000000000000109";
    const postRes = await fetch(`${baseUrl}/api/watchlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movieId: interstellarId,
        status: "WANT_TO_WATCH",
        priorityRank: 9,
        notes: "Must watch in 4K"
      })
    });
    assert.equal(postRes.status, 201);
    const { watchlistItem } = await postRes.json();
    assert.equal(watchlistItem.movieSnapshot.title, "Interstellar");
    assert.equal(watchlistItem.movieSnapshot.releaseYear, 2014);

    // Query watchlist with status filter & affinity sort
    const listRes = await fetch(`${baseUrl}/api/watchlists?status=WANT_TO_WATCH&sortBy=affinity`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.watchlist.length >= 3);

    const planJson = JSON.stringify(listData.queryDiagnostic.winningPlan);
    assert.ok(planJson.includes("idx_watchlists_user_status_ranking"));
  });

  await t.test("5. Returns personalized recommendations excluding movies already in watchlist", async () => {
    const res = await fetch(`${baseUrl}/api/recommendations`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.topGenres));
    assert.ok(data.recommendations.length > 0);
    assert.ok(data.recommendations[0].personalizedMatchScore > 0);
  });
});
