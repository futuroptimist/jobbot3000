# jobbot3000 static tracker

Serve this directory as immutable static assets plus `/healthz` and `/livez`.
Private tracker data remains in browser IndexedDB; do not add upload or
server persistence handlers to this artifact.
