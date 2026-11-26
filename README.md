# MovieMantis — MongoDB Schema, Validation & Index Design

MongoDB data model for **MovieMantis**, a movie discovery application supporting faceted catalog filtering, user watchlists, and recommendation ranking.

---

## 1. Files in This Repository

- [`schema.mongodb.js`](./schema.mongodb.js) — Defines the `movies` and `watchlists` collections with strict `$jsonSchema` validation rules, the Extended Reference relationship structure, and ESR-aligned compound indexes.
- [`queries.mongodb.js`](./queries.mongodb.js) — Inserts validated seed data and runs the target discovery and watchlist ranking queries backed by the indexes.

---

## 2. Setup & Execution

### Prerequisites
- MongoDB `6.0+` or `7.0+` running locally (or an Atlas cluster URI)
- `mongosh` (MongoDB Shell) installed

### Apply Schemas, Validation, and Indexes
```bash
mongosh "mongodb://localhost:27017/moviemantis" schema.mongodb.js
```

### Run Sample Data & Verified Queries
```bash
mongosh "mongodb://localhost:27017/moviemantis" queries.mongodb.js
```

---

## 3. Entity Schemas & Validation Design

### Entity 1: `movies` (Discovery Catalog & Ranking Signals)
Represents canonical movie metadata, filterable discovery attributes, and precomputed ranking signals.
- **Core Fields**: `title`, `slug`, `synopsis`, `releaseYear`, `runtimeMinutes`, `contentRating`, `genres`, `languages`, `streamingProviders`, `posterUrl`.
- **Ranking Subdocument (`metrics`)**:
  - `avgRating` (`double`, `0.0–10.0`) — Bayesian-weighted user score.
  - `ratingCount` (`int`, `>= 0`) — Total verified votes.
  - `popularityScore` (`double`, `>= 0.0`) — Time-decayed engagement score.
  - `recommendationScore` (`double`, `0.0–100.0`) — Global composite recommendation score used to rank discovery feeds.
- **Validation (`$jsonSchema`, `strict` / `error`)**:
  - Enforces required fields, `additionalProperties: false`, URL patterns on `posterUrl`, slug regex (`^[a-z0-9]+(-[a-z0-9]+)*$`), bounded integer ranges on `releaseYear` (`1888–2100`) and `runtimeMinutes` (`1–1440`), and controlled `enum` values for `contentRating`, `genres`, and `streamingProviders`.

### Entity 2: `watchlists` (User Watchlist & Personalized Ranking)
Represents a user's saved movie entry, lifecycle status, and personalized recommendation affinity.
- **Core Fields**: `userId`, `movieId`, `status` (`WANT_TO_WATCH`, `WATCHING`, `WATCHED`, `DROPPED`), `priorityRank` (`1–10`), `affinityScore` (`0.0–100.0`), `userRating` (`1–10` or `null`), `notes`, `movieSnapshot`, `addedAt`.
- **Validation (`$jsonSchema`, `strict` / `error`)**:
  - Enforces `ObjectId` types on `userId` and `movieId`, status enum values, bounded `priorityRank` (`1–10`) and `affinityScore` (`0.0–100.0`), and requires the embedded `movieSnapshot` object to include `title`, `releaseYear`, `runtimeMinutes`, and `genres`.

---

## 4. Relationship Strategy: Extended Reference Pattern

`movies` and `watchlists` have a **1-to-Many** relationship (one movie appears on many users' watchlists; one user has many watchlist items). We use the **Extended Reference Pattern**:

1. **Foreign Key Reference (`watchlists.movieId -> movies._id`)**:
   - Each watchlist entry is a standalone document in `watchlists` referencing `movies._id` via `movieId` (`ObjectId`) and the user via `userId` (`ObjectId`).
   - **Why not embed watchlists inside `movies`?** Popular movies (e.g., *Dune: Part Two*) can be bookmarked by hundreds of thousands of users, which would create an unbounded array inside `movies`, causing document growth contention and risking MongoDB's 16 MB BSON document limit.
   - **Why not embed all watchlist items inside a single `user` document?** Power users can accumulate thousands of watched/saved movies over time; separate `watchlists` documents allow independent pagination, status filtering, and per-item updates without rewriting a large parent document.
2. **Embedded Read Snapshot (`watchlists.movieSnapshot`)**:
   - Copies only the high-read, rarely changing card display fields (`title`, `releaseYear`, `runtimeMinutes`, `genres`, `posterUrl`) directly into the `watchlists` document.
   - **Benefit**: Rendering a user's watchlist screen or "What to Watch Tonight" recommendation queue executes as a single collection read on `watchlists` with **zero `$lookup` joins**.
   - **Trade-off**: Slight storage duplication (~150 bytes per watchlist entry). If a movie's `title` or `posterUrl` is corrected in `movies`, an asynchronous background job updates matching `watchlists.movieSnapshot` documents by `movieId`.

---

## 5. Index Design, Target Queries & Trade-offs

Both primary indexes follow MongoDB's **ESR (Equality, Sort, Range)** guideline so the query planner avoids in-memory `SORT` stages (`scanAndOrder: false`).

### Index 1: `idx_movies_discovery_esr` on `movies`
```javascript
db.movies.createIndex(
  {
    genres: 1,
    contentRating: 1,
    "metrics.recommendationScore": -1,
    releaseYear: -1
  },
  { name: "idx_movies_discovery_esr" }
);
```
- **Query It Improves**:
  The primary movie discovery query where users filter by genre and content rating, narrow by release year window, and sort results by highest recommendation ranking:
  ```javascript
  db.movies
    .find({
      genres: "Sci-Fi",
      contentRating: "PG-13",
      releaseYear: { $gte: 2015, $lte: 2026 }
    })
    .sort({ "metrics.recommendationScore": -1 })
    .limit(20);
  ```
- **How It Works (ESR)**:
  - **Equality (`E`)**: `genres` and `contentRating` match exact filter predicates first.
  - **Sort (`S`)**: `"metrics.recommendationScore": -1` is positioned immediately after the equality prefix, allowing MongoDB to walk the B-tree in pre-sorted descending recommendation order and stop after `limit(20)` matches without an in-memory blocking sort.
  - **Range (`R`)**: `releaseYear` is evaluated within the index key itself (`IXSCAN`) before fetching full documents.
- **Trade-offs**:
  1. **Multikey Index Write Amplification**: Because `genres` is an array (`1–8` elements), MongoDB creates one index entry per genre in the array. Updating `metrics.recommendationScore` (which changes frequently as recommendation models re-score titles) must update `N` index entries per movie (`N = genres.length`), increasing write I/O.
  2. **RAM Footprint**: The 4-field compound multikey index consumes additional WiredTiger cache memory proportional to `total_movies * avg_genres_per_movie`.

---

### Index 2: `idx_watchlists_user_status_ranking` on `watchlists`
```javascript
db.watchlists.createIndex(
  {
    userId: 1,
    status: 1,
    affinityScore: -1,
    priorityRank: -1
  },
  { name: "idx_watchlists_user_status_ranking" }
);
```
*(Paired with a unique integrity index `{ userId: 1, movieId: 1 }` to prevent duplicate watchlist additions.)*

- **Query It Improves**:
  Fetching a user's active watchlist (`status: "WANT_TO_WATCH"`) ordered by personalized recommendation affinity (`affinityScore`) with user-assigned `priorityRank` as a tie-breaker:
  ```javascript
  db.watchlists
    .find({
      userId: ObjectId("65f1a0000000000000000999"),
      status: "WANT_TO_WATCH"
    })
    .sort({ affinityScore: -1, priorityRank: -1 })
    .limit(50);
  ```
- **How It Works (ESR)**:
  - **Equality (`E`)**: `userId` and `status` narrow the B-tree scan to a single user's active bucket.
  - **Sort (`S`)**: `affinityScore: -1, priorityRank: -1` matches the query's compound sort direction identically, delivering the top 50 personalized watchlist recommendations directly from the index scan without a memory sort stage.
- **Trade-offs**:
  1. **Re-indexing Overhead on Recommendation Re-ranking**: Whenever the recommendation engine recalculates a user's `affinityScore` or the user toggles `status` (`WANT_TO_WATCH` -> `WATCHED`) or adjusts `priorityRank`, MongoDB must move the entry within this B-tree index.
  2. **Prefix Dependency**: Because `userId` is the leading key, this index does not accelerate global analytics queries across all users (e.g., *"count how many users have `movieId: X` in `WANT_TO_WATCH` status"*), which would require a separate `movieId`-prefixed index if needed in the future.
