/**
 * MovieMantis — Seed Data & Target Queries Demonstration
 * Run with mongosh after schema.mongodb.js:
 *   mongosh "mongodb://localhost:27017/moviemantis" queries.mongodb.js
 */

const targetDb = db.getSiblingDB("moviemantis");

// Clean existing demo data
targetDb.movies.deleteMany({});
targetDb.watchlists.deleteMany({});

const movie1Id = new ObjectId("65f1a0000000000000000101");
const movie2Id = new ObjectId("65f1a0000000000000000102");
const userId = new ObjectId("65f1a0000000000000000999");

// 1. Seed sample validated documents
targetDb.movies.insertMany([
  {
    _id: movie1Id,
    title: "Arrival",
    slug: "arrival-2016",
    synopsis: "A linguist works with the military to communicate with alien lifeforms.",
    releaseYear: 2016,
    runtimeMinutes: 116,
    contentRating: "PG-13",
    genres: ["Sci-Fi", "Drama"],
    languages: ["en"],
    streamingProviders: ["Netflix", "Prime Video"],
    posterUrl: "https://cdn.moviemantis.example/posters/arrival-2016.jpg",
    metrics: {
      avgRating: Double(8.4),
      ratingCount: Int32(42500),
      popularityScore: Double(88.5),
      recommendationScore: Double(94.2)
    },
    createdAt: new Date("2026-01-10T10:00:00Z"),
    updatedAt: new Date("2026-11-20T12:00:00Z")
  },
  {
    _id: movie2Id,
    title: "Dune: Part Two",
    slug: "dune-part-two-2024",
    synopsis: "Paul Atreides unites with the Fremen while on a warpath of revenge.",
    releaseYear: 2024,
    runtimeMinutes: 166,
    contentRating: "PG-13",
    genres: ["Sci-Fi", "Action", "Adventure"],
    languages: ["en"],
    streamingProviders: ["Max", "Apple TV+"],
    posterUrl: "https://cdn.moviemantis.example/posters/dune-part-two-2024.jpg",
    metrics: {
      avgRating: Double(8.8),
      ratingCount: Int32(91200),
      popularityScore: Double(96.1),
      recommendationScore: Double(97.8)
    },
    createdAt: new Date("2026-02-01T10:00:00Z"),
    updatedAt: new Date("2026-11-25T15:30:00Z")
  }
]);

targetDb.watchlists.insertMany([
  {
    userId: userId,
    movieId: movie1Id,
    status: "WANT_TO_WATCH",
    priorityRank: Int32(8),
    affinityScore: Double(92.4),
    userRating: null,
    notes: "Recommended by sci-fi weekly digest",
    movieSnapshot: {
      title: "Arrival",
      releaseYear: Int32(2016),
      runtimeMinutes: Int32(116),
      genres: ["Sci-Fi", "Drama"],
      posterUrl: "https://cdn.moviemantis.example/posters/arrival-2016.jpg"
    },
    addedAt: new Date("2026-11-01T18:00:00Z")
  },
  {
    userId: userId,
    movieId: movie2Id,
    status: "WANT_TO_WATCH",
    priorityRank: Int32(10),
    affinityScore: Double(98.1),
    userRating: null,
    notes: "Watch on IMAX or home theater this weekend",
    movieSnapshot: {
      title: "Dune: Part Two",
      releaseYear: Int32(2024),
      runtimeMinutes: Int32(166),
      genres: ["Sci-Fi", "Action", "Adventure"],
      posterUrl: "https://cdn.moviemantis.example/posters/dune-part-two-2024.jpg"
    },
    addedAt: new Date("2026-11-15T20:15:00Z")
  }
]);

// ============================================================================
// Query 1: Movie Discovery Filter + Recommendation Ranking
// Uses Index 1: `idx_movies_discovery_esr`
// ({ genres: 1, contentRating: 1, "metrics.recommendationScore": -1, releaseYear: -1 })
// ============================================================================
const discoveryResults = targetDb.movies
  .find(
    {
      genres: "Sci-Fi",
      contentRating: "PG-13",
      releaseYear: { $gte: 2015, $lte: 2026 }
    },
    {
      title: 1,
      releaseYear: 1,
      genres: 1,
      "metrics.recommendationScore": 1,
      posterUrl: 1
    }
  )
  .sort({ "metrics.recommendationScore": -1 })
  .limit(20)
  .toArray();

print("Discovery Query Results:", EJSON.stringify(discoveryResults, null, 2));

// ============================================================================
// Query 2: User Watchlist Filtered by Status & Ranked by Recommendation Affinity
// Uses Index 2: `idx_watchlists_user_status_ranking`
// ({ userId: 1, status: 1, affinityScore: -1, priorityRank: -1 })
// ============================================================================
const watchlistResults = targetDb.watchlists
  .find(
    {
      userId: userId,
      status: "WANT_TO_WATCH"
    },
    {
      movieId: 1,
      status: 1,
      affinityScore: 1,
      priorityRank: 1,
      movieSnapshot: 1
    }
  )
  .sort({ affinityScore: -1, priorityRank: -1 })
  .limit(50)
  .toArray();

print("Watchlist Ranked Results:", EJSON.stringify(watchlistResults, null, 2));
