// SafyEdu MongoDB — Replica Set initialization
// Runs inside the container on first boot via initdb.d
// Initialises a single-node replica set named "rs0".
// Required for:
//   - Mongoose sessions / multi-document transactions
//   - Native MongoDB time-series collections
//   - $changeStream support (real-time triggers in Phase 4)

rs.initiate({
  _id: "rs0",
  members: [{ _id: 0, host: "mongodb:27017" }],
});
