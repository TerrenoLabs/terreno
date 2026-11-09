#!/usr/bin/env bash
# Cloud Agent start script for the Terreno monorepo.
# Per-boot reconciliation: brings up a single-node MongoDB replica set (required
# for change streams) and seeds the example dev users. Idempotent and safe to
# re-run. The backend and frontend dev servers run in the configured terminals.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$HOME/.bun/bin:$PATH"

MONGOD_BIN="$HOME/.local/mongod-bin/mongod"
DBPATH="$HOME/.local/mongo-data"
MONGO_LOG="$HOME/.local/mongod.log"

export MONGO_URI="mongodb://127.0.0.1:27017/terreno-example?replicaSet=rs0"
export TOKEN_SECRET="dev-token-secret"
export TOKEN_ISSUER="terreno-dev"
export REFRESH_TOKEN_SECRET="dev-refresh-secret"
export SESSION_SECRET="dev-session-secret"

mkdir -p "$DBPATH"

# 1. Start mongod as a single-node replica set if it is not already running.
if ! pgrep -f "mongod --replSet rs0 --port 27017" >/dev/null 2>&1; then
  echo "Starting mongod..."
  nohup "$MONGOD_BIN" --replSet rs0 --port 27017 --bind_ip 127.0.0.1 --dbpath "$DBPATH" >"$MONGO_LOG" 2>&1 &
fi

# 2. Wait for mongod to accept connections.
mongo_ready=false
for _ in $(seq 1 60); do
  if node -e 'import("mongodb").then(async({MongoClient})=>{const c=new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=800");await c.connect();await c.close();process.exit(0);}).catch(()=>process.exit(1));' 2>/dev/null; then
    mongo_ready=true
    break
  fi
  sleep 1
done
if [ "$mongo_ready" != "true" ]; then
  echo "ERROR: mongod did not accept connections on 127.0.0.1:27017 (see $MONGO_LOG)" >&2
  exit 1
fi

# 3. Initiate the replica set (idempotent; ignores "already initialized").
node -e 'import("mongodb").then(async({MongoClient})=>{const c=new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true");await c.connect();await c.db("admin").command({replSetInitiate:{_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}}).catch(()=>{});await c.close();});'

# 4. Wait for the node to become PRIMARY (myState === 1); fail if it never does.
is_primary=false
for _ in $(seq 1 60); do
  STATE="$(node -e 'import("mongodb").then(async({MongoClient})=>{const c=new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true");await c.connect();const s=await c.db("admin").command({replSetGetStatus:1}).catch(()=>({myState:0}));console.log(s.myState);await c.close();}).catch(()=>console.log(0));' 2>/dev/null || echo 0)"
  if [ "$STATE" = "1" ]; then
    is_primary=true
    break
  fi
  sleep 1
done
if [ "$is_primary" != "true" ]; then
  echo "ERROR: replica set rs0 did not reach PRIMARY within 60s (see $MONGO_LOG)" >&2
  exit 1
fi

# 5. Seed the example dev users (idempotent upsert). Fatal on failure so callers
#    never boot terminals against unseeded accounts.
#    test@example.com / admin@example.com, password: testpassword123
if ! bun run backend:seed; then
  echo "ERROR: backend:seed failed" >&2
  exit 1
fi

echo "start.sh complete: mongod replica set primary, dev users seeded"
