/**
 * MovieMantis — MongoDB Schema, Validation, Relationship Strategy & Indexes
 * Context: Movie discovery app (filters, watchlists, and recommendation ranking)
 *
 * Run with mongosh:
 *   mongosh "mongodb://localhost:27017/moviemantis" schema.mongodb.js
 */

const dbName = "moviemantis";
const targetDb = db.getSiblingDB(dbName);

// ============================================================================
// 1. ENTITY 1: `movies` Collection (Catalog, Filters & Recommendation Signals)
// ============================================================================
// Stores core movie discovery attributes, filter facets (genres, releaseYear,
// streamingProviders, contentRating, runtimeMinutes), and precomputed
// recommendation ranking signals (recommendationScore, popularityScore).

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
      _id: {
        bsonType: "objectId",
        description: "Primary key for the movie document"
      },
      title: {
        bsonType: "string",
        minLength: 1,
        maxLength: 250,
        description: "Display title of the movie"
      },
      slug: {
        bsonType: "string",
        pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
        description: "URL-safe unique identifier (e.g., 'dune-part-two-2024')"
      },
      synopsis: {
        bsonType: "string",
        maxLength: 2000,
        description: "Short plot summary for discovery cards"
      },
      releaseYear: {
        bsonType: "int",
        minimum: 1888,
        maximum: 2100,
        description: "4-digit theatrical/streaming release year used in range filters"
      },
      runtimeMinutes: {
        bsonType: "int",
        minimum: 1,
        maximum: 1440,
        description: "Movie duration in minutes for runtime filtering"
      },
      contentRating: {
        enum: ["G", "PG", "PG-13", "R", "NC-17", "NR"],
        description: "MPAA content rating filter"
      },
      genres: {
        bsonType: "array",
        minItems: 1,
        maxItems: 8,
        uniqueItems: true,
        items: {
          bsonType: "string",
          enum: [
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
          ]
        },
        description: "List of genres used for multi-genre discovery filtering"
      },
      languages: {
        bsonType: "array",
        minItems: 1,
        uniqueItems: true,
        items: { bsonType: "string", minLength: 2, maxLength: 10 },
        description: "ISO language codes available (e.g., ['en', 'hi', 'ja'])"
      },
      streamingProviders: {
        bsonType: "array",
        uniqueItems: true,
        items: {
          bsonType: "string",
          enum: ["Netflix", "Prime Video", "Max", "Disney+", "Apple TV+", "Hulu", "MUBI"]
        },
        description: "Active streaming platforms for availability filtering"
      },
      posterUrl: {
        bsonType: "string",
        pattern: "^https?://",
        description: "Canonical poster URL (duplicated into watchlist snapshots)"
      },
      metrics: {
        bsonType: "object",
        required: ["avgRating", "ratingCount", "popularityScore", "recommendationScore"],
        additionalProperties: false,
        properties: {
          avgRating: {
            bsonType: "double",
            minimum: 0.0,
            maximum: 10.0,
            description: "Bayesian-weighted user rating (0.0 - 10.0)"
          },
          ratingCount: {
            bsonType: "int",
            minimum: 0,
            description: "Total count of verified user ratings"
          },
          popularityScore: {
            bsonType: "double",
            minimum: 0.0,
            description: "Time-decayed engagement score (views + watchlist adds)"
          },
          recommendationScore: {
            bsonType: "double",
            minimum: 0.0,
            maximum: 100.0,
            description: "Composite ranking score combining quality, freshness, and velocity"
          }
        }
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

if (!targetDb.getCollectionNames().includes("movies")) {
  targetDb.createCollection("movies", {
    validator: moviesValidator,
    validationLevel: "strict",
    validationAction: "error"
  });
} else {
  targetDb.runCommand({
    collMod: "movies",
    validator: moviesValidator,
    validationLevel: "strict",
    validationAction: "error"
  });
}

// ============================================================================
// 2. ENTITY 2: `watchlists` Collection (User Watchlist Entries)
// ============================================================================
// Relationship Strategy: Extended Reference Pattern (1-to-Many: Movie -> Watchlist Entries)
// - Stores `movieId` (ObjectId reference to `movies._id`) instead of embedding
//   full watchlists inside `movies` (which would create unbounded arrays) or
//   embedding an unbounded array of movies inside a single user document.
// - Embeds a lightweight, read-heavy `movieSnapshot` (`title`, `releaseYear`,
//   `genres`, `posterUrl`, `runtimeMinutes`) so rendering a user's watchlist UI
//   requires zero `$lookup` joins while still linking to `movies._id` for deep
//   detail views and live recommendation score refreshes.

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
      _id: {
        bsonType: "objectId"
      },
      userId: {
        bsonType: "objectId",
        description: "Reference to the user who owns this watchlist entry"
      },
      movieId: {
        bsonType: "objectId",
        description: "Foreign key reference to movies._id"
      },
      status: {
        enum: ["WANT_TO_WATCH", "WATCHING", "WATCHED", "DROPPED"],
        description: "Watchlist lifecycle state"
      },
      priorityRank: {
        bsonType: "int",
        minimum: 1,
        maximum: 10,
        description: "User-assigned urgency (1 = lowest, 10 = highest)"
      },
      affinityScore: {
        bsonType: "double",
        minimum: 0.0,
        maximum: 100.0,
        description: "Personalized recommendation match score for this user + movie pair"
      },
      userRating: {
        bsonType: ["int", "null"],
        minimum: 1,
        maximum: 10,
        description: "Optional user rating once watched"
      },
      notes: {
        bsonType: "string",
        maxLength: 500,
        description: "Optional personal note or tag context"
      },
      movieSnapshot: {
        bsonType: "object",
        required: ["title", "releaseYear", "genres", "runtimeMinutes"],
        additionalProperties: false,
        description: "Extended Reference snapshot to render watchlist cards without $lookup",
        properties: {
          title: { bsonType: "string", minLength: 1, maxLength: 250 },
          releaseYear: { bsonType: "int", minimum: 1888, maximum: 2100 },
          runtimeMinutes: { bsonType: "int", minimum: 1, maximum: 1440 },
          genres: {
            bsonType: "array",
            minItems: 1,
            items: { bsonType: "string" }
          },
          posterUrl: { bsonType: "string", pattern: "^https?://" }
        }
      },
      addedAt: {
        bsonType: "date",
        description: "Timestamp when the movie was added to the user's watchlist"
      },
      updatedAt: {
        bsonType: "date"
      }
    }
  }
};

if (!targetDb.getCollectionNames().includes("watchlists")) {
  targetDb.createCollection("watchlists", {
    validator: watchlistsValidator,
    validationLevel: "strict",
    validationAction: "error"
  });
} else {
  targetDb.runCommand({
    collMod: "watchlists",
    validator: watchlistsValidator,
    validationLevel: "strict",
    validationAction: "error"
  });
}

// ============================================================================
// 3. INDEXES (Following the ESR — Equality, Sort, Range Rule)
// ============================================================================

// Index 1: Movie Discovery Filter + Recommendation Ranking (Compound Multikey Index)
// Supports filtering by genre & contentRating (Equality), ordering by
// metrics.recommendationScore DESC (Sort), and bounding releaseYear (Range).
targetDb.movies.createIndex(
  {
    genres: 1,
    contentRating: 1,
    "metrics.recommendationScore": -1,
    releaseYear: -1
  },
  {
    name: "idx_movies_discovery_esr"
  }
);

// Index 2: User Watchlist Filtering & Recommendation Queue (Compound + Unique Constraint)
// 2a. Primary query index for loading a user's active watchlist ordered by personalized
//     recommendation affinityScore and user priorityRank.
targetDb.watchlists.createIndex(
  {
    userId: 1,
    status: 1,
    affinityScore: -1,
    priorityRank: -1
  },
  {
    name: "idx_watchlists_user_status_ranking"
  }
);

// Supporting integrity index: prevents duplicate entries of the same movie in a user's watchlist
targetDb.watchlists.createIndex(
  {
    userId: 1,
    movieId: 1
  },
  {
    name: "idx_watchlists_user_movie_unique",
    unique: true
  }
);

print("Successfully configured 'movies' and 'watchlists' collections with validation and indexes.");
