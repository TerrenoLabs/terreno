# The OAuth secret containers were created by hand (docs/how-to/set-up-social-login.md) so a
# preview could sign in before this module was first applied. These blocks adopt them on that
# apply; once it has run they are no-ops and can be deleted.

import {
  to = module.backend_secret_oauth["google-client-id"].google_secret_manager_secret.this
  id = "projects/flourish-terreno/secrets/terreno-backend-example-google-client-id"
}

import {
  to = module.backend_secret_oauth["google-client-secret"].google_secret_manager_secret.this
  id = "projects/flourish-terreno/secrets/terreno-backend-example-google-client-secret"
}

import {
  to = module.backend_secret_oauth["github-client-id"].google_secret_manager_secret.this
  id = "projects/flourish-terreno/secrets/terreno-backend-example-github-client-id"
}

import {
  to = module.backend_secret_oauth["github-client-secret"].google_secret_manager_secret.this
  id = "projects/flourish-terreno/secrets/terreno-backend-example-github-client-secret"
}

import {
  to = module.backend_secret_oauth["apple-client-id"].google_secret_manager_secret.this
  id = "projects/flourish-terreno/secrets/terreno-backend-example-apple-client-id"
}

import {
  to = module.backend_secret_oauth["apple-team-id"].google_secret_manager_secret.this
  id = "projects/flourish-terreno/secrets/terreno-backend-example-apple-team-id"
}

import {
  to = module.backend_secret_oauth["apple-key-id"].google_secret_manager_secret.this
  id = "projects/flourish-terreno/secrets/terreno-backend-example-apple-key-id"
}

import {
  to = module.backend_secret_oauth["apple-private-key"].google_secret_manager_secret.this
  id = "projects/flourish-terreno/secrets/terreno-backend-example-apple-private-key"
}
