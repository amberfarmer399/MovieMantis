/**
 * MovieMantis — Full-Stack Server (Express + Native MongoDB Driver)
 * Applies the strict $jsonSchema validators, Extended Reference relationship pattern,
 * and ESR compound indexes on startup, seeds rich initial data if empty, and serves
 * the discovery, watchlist, recommendation ranking, and query-plan telemetry APIs.
 */

const express = require("express");
const path = require("path");
const { MongoClient, ObjectId, Int32, Double } = require("mongodb");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "moviemantis";

// Default active demo user ObjectId for single-user / demo session
const DEFAULT_USER_ID = new ObjectId("65f1a0000000000000000999");

// ============================================================================
// 1. JSON Schema Validators (Identical to schema.mongodb.js)
// ============================================================================

const GENRE_ENUM = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller"
];

const RATING_ENUM = ["G", "PG", "PG-13", "R", "NC-17", "NR"];

const PROVIDER_ENUM = [
  "Netflix",
  "Prime Video",
  "Max",
  "Disney+",
  "Apple TV+",
  "Hulu",
  "MUBI"
];

const WATCHLIST_STATUS_ENUM = ["WANT_TO_WATCH", "WATCHING", "WATCHED", "DROPPED"];

const moviesValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "title",
      "slug",
      "releaseYear",
      "genres",
      "runtimeMinutes",
      "contentRating",
      "metrics",
      "createdAt"
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      title: { bsonType: "string", minLength: 1, maxLength: 250 },
      slug: { bsonType: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
      synopsis: { bsonType: "string", maxLength: 2000 },
      releaseYear: { bsonType: "int", minimum: 1888, maximum: 2100 },
      runtimeMinutes: { bsonType: "int", minimum: 1, maximum: 1440 },
      contentRating: { enum: RATING_ENUM },
      genres: {
        bsonType: "array",
        minItems: 1,
        maxItems: 8,
        uniqueItems: true,
        items: { bsonType: "string", enum: GENRE_ENUM }
      },
      languages: {
        bsonType: "array",
        minItems: 1,
        uniqueItems: true,
        items: { bsonType: "string", minLength: 2, maxLength: 10 }
      },
      streamingProviders: {
        bsonType: "array",
        uniqueItems: true,
        items: { bsonType: "string", enum: PROVIDER_ENUM }
      },
      posterUrl: { bsonType: "string", pattern: "^https?://" },
      metrics: {
        bsonType: "object",
        required: ["avgRating", "ratingCount", "popularityScore", "recommendationScore"],
        additionalProperties: false,
        properties: {
          avgRating: { bsonType: "double", minimum: 0.0, maximum: 10.0 },
          ratingCount: { bsonType: "int", minimum: 0 },
          popularityScore: { bsonType: "double", minimum: 0.0 },
          recommendationScore: { bsonType: "double", minimum: 0.0, maximum: 100.0 }
        }
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

const watchlistsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "userId",
      "movieId",
      "status",
      "priorityRank",
      "affinityScore",
      "movieSnapshot",
      "addedAt"
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      movieId: { bsonType: "objectId" },
      status: { enum: WATCHLIST_STATUS_ENUM },
      priorityRank: { bsonType: "int", minimum: 1, maximum: 10 },
      affinityScore: { bsonType: "double", minimum: 0.0, maximum: 100.0 },
      userRating: { bsonType: ["int", "null"], minimum: 1, maximum: 10 },
      notes: { bsonType: "string", maxLength: 500 },
      movieSnapshot: {
        bsonType: "object",
        required: ["title", "releaseYear", "genres", "runtimeMinutes"],
        additionalProperties: false,
        properties: {
          title: { bsonType: "string", minLength: 1, maxLength: 250 },
          releaseYear: { bsonType: "int", minimum: 1888, maximum: 2100 },
          runtimeMinutes: { bsonType: "int", minimum: 1, maximum: 1440 },
          genres: { bsonType: "array", minItems: 1, items: { bsonType: "string" } },
          posterUrl: { bsonType: "string", pattern: "^https?://" }
        }
      },
      addedAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

// ============================================================================
// 2. Seed Data Catalog
// ============================================================================

const INITIAL_MOVIES = [
  {
    _id: new ObjectId("65f1a0000000000000000101"),
    title: "Arrival",
    slug: "arrival-2016",
    synopsis: "A linguist works with the military to communicate with alien lifeforms after twelve mysterious spacecraft appear around the world.",
    releaseYear: 2016,
    runtimeMinutes: 116,
    contentRating: "PG-13",
    genres: ["Sci-Fi", "Drama", "Mystery"],
    languages: ["en"],
    streamingProviders: ["Netflix", "Prime Video"],
    posterUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.4,
      ratingCount: 42500,
      popularityScore: 88.5,
      recommendationScore: 94.2
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000102"),
    title: "Dune: Part Two",
    slug: "dune-part-two-2024",
    synopsis: "Paul Atreides unites with Chani and the Fremen while on a warpath of revenge against the conspirators who destroyed his family.",
    releaseYear: 2024,
    runtimeMinutes: 166,
    contentRating: "PG-13",
    genres: ["Sci-Fi", "Action", "Adventure"],
    languages: ["en"],
    streamingProviders: ["Max", "Apple TV+"],
    posterUrl: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.8,
      ratingCount: 91200,
      popularityScore: 96.1,
      recommendationScore: 97.8
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000103"),
    title: "Spider-Man: Across the Spider-Verse",
    slug: "spider-man-across-the-spider-verse-2023",
    synopsis: "Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence.",
    releaseYear: 2023,
    runtimeMinutes: 140,
    contentRating: "PG",
    genres: ["Animation", "Action", "Sci-Fi", "Adventure"],
    languages: ["en"],
    streamingProviders: ["Netflix", "Disney+"],
    posterUrl: "https://images.unsplash.com/photo-1635805737707-575885ab0820?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.7,
      ratingCount: 78400,
      popularityScore: 93.4,
      recommendationScore: 96.1
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000104"),
    title: "Oppenheimer",
    slug: "oppenheimer-2023",
    synopsis: "The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb during World War II.",
    releaseYear: 2023,
    runtimeMinutes: 180,
    contentRating: "R",
    genres: ["Drama", "Thriller"],
    languages: ["en"],
    streamingProviders: ["Prime Video", "Apple TV+"],
    posterUrl: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.6,
      ratingCount: 89000,
      popularityScore: 92.0,
      recommendationScore: 95.3
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000105"),
    title: "Parasite",
    slug: "parasite-2019",
    synopsis: "Greed and class discrimination threaten the newly formed symbiotic relationship between the wealthy Park family and the destitute Kim clan.",
    releaseYear: 2019,
    runtimeMinutes: 132,
    contentRating: "R",
    genres: ["Thriller", "Drama", "Comedy"],
    languages: ["ko", "en"],
    streamingProviders: ["Max", "Hulu", "MUBI"],
    posterUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.6,
      ratingCount: 95400,
      popularityScore: 89.7,
      recommendationScore: 94.9
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000106"),
    title: "Everything Everywhere All at Once",
    slug: "everything-everywhere-all-at-once-2022",
    synopsis: "A middle-aged Chinese immigrant is swept up into an insane adventure in which she alone can save existence by exploring other universes.",
    releaseYear: 2022,
    runtimeMinutes: 139,
    contentRating: "R",
    genres: ["Sci-Fi", "Action", "Comedy", "Adventure"],
    languages: ["en", "zh"],
    streamingProviders: ["Netflix", "Prime Video", "MUBI"],
    posterUrl: "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.1,
      ratingCount: 68200,
      popularityScore: 87.3,
      recommendationScore: 91.5
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000107"),
    title: "Blade Runner 2049",
    slug: "blade-runner-2049-2017",
    synopsis: "Young Blade Runner K's discovery of a long-buried secret leads him to track down former Blade Runner Rick Deckard, who's been missing for thirty years.",
    releaseYear: 2017,
    runtimeMinutes: 164,
    contentRating: "R",
    genres: ["Sci-Fi", "Mystery", "Thriller", "Drama"],
    languages: ["en"],
    streamingProviders: ["Max", "Prime Video"],
    posterUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.3,
      ratingCount: 64100,
      popularityScore: 86.2,
      recommendationScore: 92.8
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000108"),
    title: "The Grand Budapest Hotel",
    slug: "the-grand-budapest-hotel-2014",
    synopsis: "A writer encounters the owner of an aging high-class hotel, who tells him of his early years serving as a lobby boy in the hotel's glorious years.",
    releaseYear: 2014,
    runtimeMinutes: 100,
    contentRating: "R",
    genres: ["Comedy", "Adventure", "Crime", "Drama"],
    languages: ["en"],
    streamingProviders: ["Disney+", "Hulu", "MUBI"],
    posterUrl: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.1,
      ratingCount: 57900,
      popularityScore: 83.4,
      recommendationScore: 89.7
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000109"),
    title: "Interstellar",
    slug: "interstellar-2014",
    synopsis: "When Earth becomes uninhabitable in the future, a farmer and ex-NASA pilot, Joseph Cooper, is tasked to pilot a spacecraft to find a new planet for humans.",
    releaseYear: 2014,
    runtimeMinutes: 169,
    contentRating: "PG-13",
    genres: ["Sci-Fi", "Drama", "Adventure"],
    languages: ["en"],
    streamingProviders: ["Prime Video", "Apple TV+", "Netflix"],
    posterUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 8.7,
      ratingCount: 112000,
      popularityScore: 95.0,
      recommendationScore: 97.1
    }
  },
  {
    _id: new ObjectId("65f1a0000000000000000110"),
    title: "Knives Out",
    slug: "knives-out-2019",
    synopsis: "A detective investigates the death of a patriarch of an eccentric, combative family inside a gothic country mansion.",
    releaseYear: 2019,
    runtimeMinutes: 130,
    contentRating: "PG-13",
    genres: ["Mystery", "Comedy", "Crime", "Thriller"],
    languages: ["en"],
    streamingProviders: ["Netflix", "Prime Video"],
    posterUrl: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=600&q=80",
    metrics: {
      avgRating: 7.9,
      ratingCount: 54000,
      popularityScore: 84.1,
      recommendationScore: 88.9
    }
  }
];

/**
 * Computes the global recommendation score (0..100) for a movie based on:
 * - Bayesian-weighted rating quality (55%)
 * - Engagement popularity score (30%)
 * - Release freshness boost (15%)
 */
function computeRecommendationScore({ avgRating, ratingCount, popularityScore, releaseYear }) {
  const bayesianPriorVotes = 5000;
  const bayesianPriorMean = 7.2;
  const weightedRating =
    (ratingCount / (ratingCount + bayesianPriorVotes)) * avgRating +
    (bayesianPriorVotes / (ratingCount + bayesianPriorVotes)) * bayesianPriorMean;

  const qualityComponent = (weightedRating / 10) * 55;
  const popularityComponent = (Math.min(100, Math.max(0, popularityScore)) / 100) * 30;
  const age = Math.max(0, 2026 - releaseYear);
  const freshnessComponent = Math.max(0, 1 - age / 40) * 15;

  return Math.min(100, Math.max(0, Number((qualityComponent + popularityComponent + freshnessComponent).toFixed(1))));
}

/**
 * Converts a plain JS movie object into strict BSON types required by $jsonSchema
 */
function toBsonMovie(raw) {
  const now = new Date();
  const avgRating = Number(raw.metrics?.avgRating ?? 7.8);
  const ratingCount = Math.max(0, parseInt(raw.metrics?.ratingCount ?? 1200, 10));
  const popularityScore = Number(raw.metrics?.popularityScore ?? 80.0);
  const releaseYear = parseInt(raw.releaseYear, 10);
  const recommendationScore =
    raw.metrics?.recommendationScore !== undefined
      ? Number(raw.metrics.recommendationScore)
      : computeRecommendationScore({ avgRating, ratingCount, popularityScore, releaseYear });

  return {
    ...(raw._id ? { _id: raw._id } : {}),
    title: String(raw.title).trim(),
    slug: String(
      raw.slug ||
        `${String(raw.title)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}-${releaseYear}`
    ),
    synopsis: String(raw.synopsis || "Added via MovieMantis catalog.").trim(),
    releaseYear: new Int32(releaseYear),
    runtimeMinutes: new Int32(parseInt(raw.runtimeMinutes, 10)),
    contentRating: String(raw.contentRating),
    genres: Array.from(new Set(raw.genres || ["Drama"])),
    languages: Array.from(new Set(raw.languages || ["en"])),
    streamingProviders: Array.from(new Set(raw.streamingProviders || ["Netflix"])),
    posterUrl: String(
      raw.posterUrl ||
        "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80"
    ),
    metrics: {
      avgRating: new Double(avgRating),
      ratingCount: new Int32(ratingCount),
      popularityScore: new Double(popularityScore),
      recommendationScore: new Double(recommendationScore)
    },
    createdAt: raw.createdAt || now,
    updatedAt: now
  };
}

/**
 * Computes personalized affinityScore (0..100) for a user's watchlist entry
 * based on the movie's global recommendationScore, genre overlap with user's
 * existing watchlist, and user priorityRank.
 */
async function computeUserAffinityScore(db, userId, movieDoc, priorityRank) {
  const existingEntries = await db
    .collection("watchlists")
    .find({ userId })
    .project({ "movieSnapshot.genres": 1, userRating: 1 })
    .toArray();

  const genreCounts = {};
  let totalGenreHits = 0;
  for (const item of existingEntries) {
    const weight = item.userRating ? item.userRating / 5 : 1;
    for (const g of item.movieSnapshot?.genres || []) {
      genreCounts[g] = (genreCounts[g] || 0) + weight;
      totalGenreHits += weight;
    }
  }

  let genreMatchRatio = 0.6;
  if (totalGenreHits > 0 && movieDoc.genres?.length) {
    let matchedWeight = 0;
    for (const g of movieDoc.genres) {
      matchedWeight += genreCounts[g] || 0;
    }
    genreMatchRatio = Math.min(1, 0.35 + (matchedWeight / totalGenreHits) * 1.4);
  }

  const baseRec = Number(movieDoc.metrics?.recommendationScore ?? 85);
  const priorityBoost = (Number(priorityRank) / 10) * 14;
  const rawAffinity = baseRec * 0.68 + genreMatchRatio * 18 + priorityBoost;
  return Number(Math.min(100, Math.max(0, rawAffinity)).toFixed(1));
}

// ============================================================================
// 3. Database Initialization (Collections, Validators, Indexes & Seed)
// ============================================================================

async function initializeDatabase(db) {
  const existingCollections = await db.listCollections().toArray();
  const names = existingCollections.map((c) => c.name);

  if (!names.includes("movies")) {
    await db.createCollection("movies", {
      validator: moviesValidator,
      validationLevel: "strict",
      validationAction: "error"
    });
  } else {
    await db.command({
      collMod: "movies",
      validator: moviesValidator,
      validationLevel: "strict",
      validationAction: "error"
    });
  }

  if (!names.includes("watchlists")) {
    await db.createCollection("watchlists", {
      validator: watchlistsValidator,
      validationLevel: "strict",
      validationAction: "error"
    });
  } else {
    await db.command({
      collMod: "watchlists",
      validator: watchlistsValidator,
      validationLevel: "strict",
      validationAction: "error"
    });
  }

  // Index 1: Movie Discovery Filter + Recommendation Ranking (Compound Multikey ESR Index)
  await db.collection("movies").createIndex(
    {
      genres: 1,
      contentRating: 1,
      "metrics.recommendationScore": -1,
      releaseYear: -1
    },
    { name: "idx_movies_discovery_esr" }
  );

  // Index 2: User Watchlist Filtering & Personalized Recommendation Queue
  await db.collection("watchlists").createIndex(
    {
      userId: 1,
      status: 1,
      affinityScore: -1,
      priorityRank: -1
    },
    { name: "idx_watchlists_user_status_ranking" }
  );

  // Supporting unique constraint index on (userId, movieId)
  await db.collection("watchlists").createIndex(
    { userId: 1, movieId: 1 },
    { name: "idx_watchlists_user_movie_unique", unique: true }
  );

  // Ensure full catalog seed movies exist
  const count = await db.collection("movies").countDocuments();
  if (count < INITIAL_MOVIES.length) {
    for (const rawMovie of INITIAL_MOVIES) {
      const bsonMovie = toBsonMovie(rawMovie);
      await db
        .collection("movies")
        .updateOne({ _id: bsonMovie._id }, { $setOnInsert: bsonMovie }, { upsert: true });
    }
  }

  // Ensure initial watchlist entries exist for the default user
  const watchlistCount = await db
    .collection("watchlists")
    .countDocuments({ userId: DEFAULT_USER_ID });

  if (watchlistCount === 0) {
    const arrival = await db
      .collection("movies")
      .findOne({ _id: new ObjectId("65f1a0000000000000000101") });
    const dune = await db
      .collection("movies")
      .findOne({ _id: new ObjectId("65f1a0000000000000000102") });
    const spiderVerse = await db
      .collection("movies")
      .findOne({ _id: new ObjectId("65f1a0000000000000000103") });

    const seedWatchlist = [
      {
        movie: dune,
        status: "WANT_TO_WATCH",
        priorityRank: 10,
        affinityScore: 98.1,
        userRating: null,
        notes: "Watch on home theater this weekend"
      },
      {
        movie: arrival,
        status: "WANT_TO_WATCH",
        priorityRank: 8,
        affinityScore: 92.4,
        userRating: null,
        notes: "Recommended by sci-fi weekly digest"
      },
      {
        movie: spiderVerse,
        status: "WATCHED",
        priorityRank: 9,
        affinityScore: 95.4,
        userRating: 10,
        notes: "Incredible animation and soundtrack"
      }
    ].filter((x) => x.movie);

    for (const entry of seedWatchlist) {
      await db.collection("watchlists").insertOne({
        userId: DEFAULT_USER_ID,
        movieId: entry.movie._id,
        status: entry.status,
        priorityRank: new Int32(entry.priorityRank),
        affinityScore: new Double(entry.affinityScore),
        userRating: entry.userRating !== null ? new Int32(entry.userRating) : null,
        notes: entry.notes,
        movieSnapshot: {
          title: entry.movie.title,
          releaseYear: new Int32(entry.movie.releaseYear),
          runtimeMinutes: new Int32(entry.movie.runtimeMinutes),
          genres: entry.movie.genres,
          posterUrl: entry.movie.posterUrl
        },
        addedAt: new Date(),
        updatedAt: new Date()
      });
    }
  }
}

// ============================================================================
// 4. Express App & API Routes
// ============================================================================

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  // GET /api/meta — Enums, schema overview & active MongoDB indexes
  app.get("/api/meta", async (req, res) => {
    try {
      const [movieIndexes, watchlistIndexes, movieCount, watchlistCount] = await Promise.all([
        db.collection("movies").indexes(),
        db.collection("watchlists").indexes(),
        db.collection("movies").countDocuments(),
        db.collection("watchlists").countDocuments({ userId: DEFAULT_USER_ID })
      ]);

      res.json({
        genres: GENRE_ENUM,
        contentRatings: RATING_ENUM,
        streamingProviders: PROVIDER_ENUM,
        watchlistStatuses: WATCHLIST_STATUS_ENUM,
        defaultUserId: DEFAULT_USER_ID.toHexString(),
        counts: { movies: movieCount, watchlist: watchlistCount },
        indexes: {
          movies: movieIndexes,
          watchlists: watchlistIndexes
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/movies — Faceted movie discovery + recommendation ranking + live explain plan
  app.get("/api/movies", async (req, res) => {
    try {
      const {
        genre,
        contentRating,
        provider,
        minYear,
        maxYear,
        maxRuntime,
        search,
        sortBy = "recommendationScore",
        limit = 24
      } = req.query;

      const filter = {};
      if (genre && genre !== "ALL") {
        filter.genres = genre;
      }
      if (contentRating && contentRating !== "ALL") {
        filter.contentRating = contentRating;
      }
      if (provider && provider !== "ALL") {
        filter.streamingProviders = provider;
      }
      if (minYear || maxYear) {
        filter.releaseYear = {};
        if (minYear) filter.releaseYear.$gte = parseInt(minYear, 10);
        if (maxYear) filter.releaseYear.$lte = parseInt(maxYear, 10);
      }
      if (maxRuntime) {
        filter.runtimeMinutes = { $lte: parseInt(maxRuntime, 10) };
      }
      if (search && search.trim()) {
        const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = [
          { title: { $regex: escaped, $options: "i" } },
          { synopsis: { $regex: escaped, $options: "i" } }
        ];
      }

      const sortMap = {
        recommendationScore: { "metrics.recommendationScore": -1, releaseYear: -1 },
        popularityScore: { "metrics.popularityScore": -1, releaseYear: -1 },
        avgRating: { "metrics.avgRating": -1, "metrics.ratingCount": -1 },
        releaseYear: { releaseYear: -1, "metrics.recommendationScore": -1 }
      };
      const sortSpec = sortMap[sortBy] || sortMap.recommendationScore;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));

      const cursor = db.collection("movies").find(filter).sort(sortSpec).limit(limitNum);
      const [movies, explain] = await Promise.all([
        cursor.toArray(),
        db
          .collection("movies")
          .find(filter)
          .sort(sortSpec)
          .limit(limitNum)
          .explain("executionStats")
      ]);

      // Extract winning plan stage details for the UI Index Inspector
      const winningPlan = explain?.queryPlanner?.winningPlan || {};
      const stats = explain?.executionStats || {};

      res.json({
        movies,
        queryDiagnostic: {
          collection: "movies",
          filter,
          sort: sortSpec,
          executionTimeMillis: stats.executionTimeMillis ?? 0,
          totalKeysExamined: stats.totalKeysExamined ?? 0,
          totalDocsExamined: stats.totalDocsExamined ?? 0,
          nReturned: stats.nReturned ?? movies.length,
          winningPlan
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/movies — Create a new movie in the catalog (Validates against $jsonSchema)
  app.post("/api/movies", async (req, res) => {
    try {
      const bsonMovie = toBsonMovie(req.body);
      const result = await db.collection("movies").insertOne(bsonMovie);
      const created = await db.collection("movies").findOne({ _id: result.insertedId });
      res.status(201).json({ movie: created });
    } catch (err) {
      const status = err.code === 121 ? 400 : 500;
      res.status(status).json({
        error: err.code === 121 ? "MongoDB $jsonSchema Validation Failed" : err.message,
        details: err.errInfo?.details || err.message
      });
    }
  });

  // PATCH /api/movies/:id — Update movie title/poster/metrics & sync Extended Reference snapshots
  app.patch("/api/movies/:id", async (req, res) => {
    try {
      const movieId = new ObjectId(req.params.id);
      const existing = await db.collection("movies").findOne({ _id: movieId });
      if (!existing) {
        return res.status(404).json({ error: "Movie not found" });
      }

      const updatedTitle = req.body.title !== undefined ? String(req.body.title).trim() : existing.title;
      const updatedPoster =
        req.body.posterUrl !== undefined ? String(req.body.posterUrl).trim() : existing.posterUrl;
      const avgRating =
        req.body.avgRating !== undefined ? Number(req.body.avgRating) : Number(existing.metrics.avgRating);
      const ratingCount =
        req.body.ratingCount !== undefined
          ? parseInt(req.body.ratingCount, 10)
          : Number(existing.metrics.ratingCount);
      const popularityScore =
        req.body.popularityScore !== undefined
          ? Number(req.body.popularityScore)
          : Number(existing.metrics.popularityScore);

      const newRecScore = computeRecommendationScore({
        avgRating,
        ratingCount,
        popularityScore,
        releaseYear: Number(existing.releaseYear)
      });

      await db.collection("movies").updateOne(
        { _id: movieId },
        {
          $set: {
            title: updatedTitle,
            posterUrl: updatedPoster,
            metrics: {
              avgRating: new Double(avgRating),
              ratingCount: new Int32(ratingCount),
              popularityScore: new Double(popularityScore),
              recommendationScore: new Double(newRecScore)
            },
            updatedAt: new Date()
          }
        }
      );

      // Extended Reference synchronization: propagate snapshot changes to watchlists
      const snapshotSyncResult = await db.collection("watchlists").updateMany(
        { movieId },
        {
          $set: {
            "movieSnapshot.title": updatedTitle,
            "movieSnapshot.posterUrl": updatedPoster,
            updatedAt: new Date()
          }
        }
      );

      const updatedMovie = await db.collection("movies").findOne({ _id: movieId });
      res.json({
        movie: updatedMovie,
        syncedWatchlistSnapshots: snapshotSyncResult.modifiedCount
      });
    } catch (err) {
      const status = err.code === 121 ? 400 : 500;
      res.status(status).json({
        error: err.code === 121 ? "MongoDB $jsonSchema Validation Failed" : err.message,
        details: err.errInfo?.details || err.message
      });
    }
  });

  // GET /api/watchlists — Fetch user's watchlist sorted by personalized recommendation affinity + explain
  app.get("/api/watchlists", async (req, res) => {
    try {
      const { status = "ALL", sortBy = "affinity" } = req.query;
      const filter = { userId: DEFAULT_USER_ID };
      if (status && status !== "ALL") {
        filter.status = status;
      }

      const sortSpec =
        sortBy === "recent"
          ? { addedAt: -1 }
          : { affinityScore: -1, priorityRank: -1 };

      const [items, explain] = await Promise.all([
        db.collection("watchlists").find(filter).sort(sortSpec).limit(50).toArray(),
        db
          .collection("watchlists")
          .find(filter)
          .sort(sortSpec)
          .limit(50)
          .explain("executionStats")
      ]);

      const stats = explain?.executionStats || {};
      res.json({
        watchlist: items,
        queryDiagnostic: {
          collection: "watchlists",
          filter: { ...filter, userId: DEFAULT_USER_ID.toHexString() },
          sort: sortSpec,
          executionTimeMillis: stats.executionTimeMillis ?? 0,
          totalKeysExamined: stats.totalKeysExamined ?? 0,
          totalDocsExamined: stats.totalDocsExamined ?? 0,
          nReturned: stats.nReturned ?? items.length,
          winningPlan: explain?.queryPlanner?.winningPlan || {}
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/watchlists — Add a movie to the user's watchlist using the Extended Reference snapshot
  app.post("/api/watchlists", async (req, res) => {
    try {
      const {
        movieId,
        status = "WANT_TO_WATCH",
        priorityRank = 8,
        notes = ""
      } = req.body;

      if (!movieId || !ObjectId.isValid(movieId)) {
        return res.status(400).json({ error: "Valid movieId is required" });
      }

      const movieObjId = new ObjectId(movieId);
      const movieDoc = await db.collection("movies").findOne({ _id: movieObjId });
      if (!movieDoc) {
        return res.status(404).json({ error: "Movie not found in catalog" });
      }

      const priorityInt = Math.min(10, Math.max(1, parseInt(priorityRank, 10) || 8));
      const computedAffinity = await computeUserAffinityScore(
        db,
        DEFAULT_USER_ID,
        movieDoc,
        priorityInt
      );

      // Build watchlist document embedding the Extended Reference `movieSnapshot`
      const watchlistDoc = {
        userId: DEFAULT_USER_ID,
        movieId: movieDoc._id,
        status,
        priorityRank: new Int32(priorityInt),
        affinityScore: new Double(computedAffinity),
        userRating: null,
        notes: String(notes || "").slice(0, 500),
        movieSnapshot: {
          title: movieDoc.title,
          releaseYear: new Int32(Number(movieDoc.releaseYear)),
          runtimeMinutes: new Int32(Number(movieDoc.runtimeMinutes)),
          genres: movieDoc.genres,
          posterUrl: movieDoc.posterUrl
        },
        addedAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection("watchlists").insertOne(watchlistDoc);

      // Also bump movie popularityScore & recompute recommendationScore
      const bumpedPopularity = Number((Number(movieDoc.metrics.popularityScore) + 1.2).toFixed(1));
      const newRecScore = computeRecommendationScore({
        avgRating: Number(movieDoc.metrics.avgRating),
        ratingCount: Number(movieDoc.metrics.ratingCount),
        popularityScore: bumpedPopularity,
        releaseYear: Number(movieDoc.releaseYear)
      });

      await db.collection("movies").updateOne(
        { _id: movieDoc._id },
        {
          $set: {
            "metrics.popularityScore": new Double(bumpedPopularity),
            "metrics.recommendationScore": new Double(newRecScore),
            updatedAt: new Date()
          }
        }
      );

      const created = await db.collection("watchlists").findOne({ _id: result.insertedId });
      res.status(201).json({ watchlistItem: created });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          error: "Movie is already in your watchlist (enforced by idx_watchlists_user_movie_unique)"
        });
      }
      const status = err.code === 121 ? 400 : 500;
      res.status(status).json({
        error: err.code === 121 ? "MongoDB $jsonSchema Validation Failed" : err.message,
        details: err.errInfo?.details || err.message
      });
    }
  });

  // PATCH /api/watchlists/:id — Update watchlist status, priorityRank, userRating, or notes
  app.patch("/api/watchlists/:id", async (req, res) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: "Invalid watchlist entry ID" });
      }
      const entryId = new ObjectId(req.params.id);
      const existing = await db.collection("watchlists").findOne({ _id: entryId });
      if (!existing) {
        return res.status(404).json({ error: "Watchlist entry not found" });
      }

      const movieDoc = await db.collection("movies").findOne({ _id: existing.movieId });
      const newStatus = req.body.status !== undefined ? req.body.status : existing.status;
      const newPriority =
        req.body.priorityRank !== undefined
          ? parseInt(req.body.priorityRank, 10)
          : Number(existing.priorityRank);
      const newUserRating =
        req.body.userRating !== undefined
          ? req.body.userRating === null || req.body.userRating === ""
            ? null
            : new Int32(parseInt(req.body.userRating, 10))
          : existing.userRating !== null
          ? new Int32(Number(existing.userRating))
          : null;
      const newNotes =
        req.body.notes !== undefined ? String(req.body.notes).slice(0, 500) : existing.notes || "";

      const newAffinity = movieDoc
        ? await computeUserAffinityScore(db, DEFAULT_USER_ID, movieDoc, newPriority)
        : Number(existing.affinityScore);

      await db.collection("watchlists").updateOne(
        { _id: entryId },
        {
          $set: {
            status: newStatus,
            priorityRank: new Int32(newPriority),
            affinityScore: new Double(newAffinity),
            userRating: newUserRating,
            notes: newNotes,
            updatedAt: new Date()
          }
        }
      );

      // If user rated the movie, fold it into the movie's Bayesian rating & recommendationScore
      if (req.body.userRating && movieDoc) {
        const ratingVal = parseInt(req.body.userRating, 10);
        const oldCount = Number(movieDoc.metrics.ratingCount);
        const oldAvg = Number(movieDoc.metrics.avgRating);
        const newCount = oldCount + 1;
        const newAvg = Number(((oldAvg * oldCount + ratingVal) / newCount).toFixed(2));
        const newRec = computeRecommendationScore({
          avgRating: newAvg,
          ratingCount: newCount,
          popularityScore: Number(movieDoc.metrics.popularityScore),
          releaseYear: Number(movieDoc.releaseYear)
        });

        await db.collection("movies").updateOne(
          { _id: movieDoc._id },
          {
            $set: {
              "metrics.avgRating": new Double(newAvg),
              "metrics.ratingCount": new Int32(newCount),
              "metrics.recommendationScore": new Double(newRec),
              updatedAt: new Date()
            }
          }
        );
      }

      const updated = await db.collection("watchlists").findOne({ _id: entryId });
      res.json({ watchlistItem: updated });
    } catch (err) {
      const status = err.code === 121 ? 400 : 500;
      res.status(status).json({
        error: err.code === 121 ? "MongoDB $jsonSchema Validation Failed" : err.message,
        details: err.errInfo?.details || err.message
      });
    }
  });

  // DELETE /api/watchlists/:id — Remove an entry from the user's watchlist
  app.delete("/api/watchlists/:id", async (req, res) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: "Invalid watchlist entry ID" });
      }
      const result = await db
        .collection("watchlists")
        .deleteOne({ _id: new ObjectId(req.params.id) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Watchlist entry not found" });
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/recommendations — Personalized recommendation ranking combining catalog + watchlist affinity
  app.get("/api/recommendations", async (req, res) => {
    try {
      const userWatchlist = await db
        .collection("watchlists")
        .find({ userId: DEFAULT_USER_ID })
        .toArray();

      const watchedOrSavedIds = new Set(userWatchlist.map((w) => w.movieId.toHexString()));

      // Build user genre affinity vector from saved & high-priority movies
      const genreWeights = {};
      for (const item of userWatchlist) {
        const weight =
          (Number(item.priorityRank) / 5) *
          (item.userRating ? Number(item.userRating) / 5 : 1) *
          (item.status === "DROPPED" ? 0.2 : 1.0);
        for (const g of item.movieSnapshot?.genres || []) {
          genreWeights[g] = (genreWeights[g] || 0) + weight;
        }
      }

      const sortedTopGenres = Object.entries(genreWeights)
        .sort((a, b) => b[1] - a[1])
        .map(([genre]) => genre);

      const allMovies = await db
        .collection("movies")
        .find({})
        .sort({ "metrics.recommendationScore": -1 })
        .toArray();

      const maxGenreWeight = Math.max(1, ...Object.values(genreWeights));

      const rankedUnwatched = allMovies
        .filter((m) => !watchedOrSavedIds.has(m._id.toHexString()))
        .map((m) => {
          let genreAffinity = 0;
          for (const g of m.genres || []) {
            genreAffinity += (genreWeights[g] || 0) / maxGenreWeight;
          }
          const normalizedAffinity = Math.min(1, genreAffinity / Math.max(1, (m.genres || []).length));
          const baseScore = Number(m.metrics.recommendationScore);
          const personalizedMatchScore = Number(
            Math.min(100, baseScore * 0.75 + normalizedAffinity * 25).toFixed(1)
          );
          const matchingGenres = (m.genres || []).filter((g) => sortedTopGenres.slice(0, 3).includes(g));

          return {
            ...m,
            personalizedMatchScore,
            matchReason:
              matchingGenres.length > 0
                ? `Matches your ${matchingGenres.join(" + ")} watchlist profile`
                : `Top global recommendation score (${baseScore})`
          };
        })
        .sort((a, b) => b.personalizedMatchScore - a.personalizedMatchScore);

      res.json({
        topGenres: sortedTopGenres.slice(0, 4),
        recommendations: rankedUnwatched
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/validate-test — Interactive endpoint to test MongoDB $jsonSchema validation rejections
  app.post("/api/validate-test", async (req, res) => {
    try {
      const { target = "movies", payload } = req.body;
      const colName = target === "watchlists" ? "watchlists" : "movies";
      await db.collection(colName).insertOne(payload);
      res.status(200).json({ valid: true, message: "Document passed validation" });
    } catch (err) {
      res.status(400).json({
        valid: false,
        code: err.code,
        error: "Rejected by MongoDB $jsonSchema validator",
        details: err.errInfo?.details || err.message
      });
    }
  });

  return app;
}

async function startServer() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  await initializeDatabase(db);
  const app = createApp(db);

  const server = app.listen(PORT, () => {
    console.log(`MovieMantis app listening at http://localhost:${PORT} (MongoDB: ${DB_NAME})`);
  });

  return { app, server, client, db };
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("Failed to start MovieMantis server:", err);
    process.exit(1);
  });
}

module.exports = {
  createApp,
  initializeDatabase,
  startServer,
  computeRecommendationScore,
  toBsonMovie,
  DEFAULT_USER_ID
};
