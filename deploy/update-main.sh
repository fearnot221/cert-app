#!/usr/bin/env bash
set -Eeuo pipefail

# Define the complete function before checking out code that may replace this script.
main() {
  local sha="${1:?Expected the CI-verified commit SHA}"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || return 2
  cd "${DEPLOY_REPO:?}"
  [[ "${DEPLOY_PROJECT:?}" == cert-app-production ]] || return 2
  mkdir -p .runtime/deploy
  exec 9>.runtime/deploy/deploy.lock
  flock 9
  docker info --format '{{.ServerVersion}}' >/dev/null
  export GIT_TERMINAL_PROMPT=0
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
  if [[ "$(git rev-parse refs/remotes/origin/main)" != "$sha" ]]; then
    echo "Skipping superseded CI commit $sha"
    return 75
  fi
  if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    echo "Refusing to overwrite local changes; no backup or stash was created." >&2
    return 1
  fi
  local -a compose=(docker compose --project-name "$DEPLOY_PROJECT" --env-file .env -f compose.production.yaml)
  local -a previous=()
  mapfile -t previous < <(
    {
      "${compose[@]}" images --quiet api worker web migrate
      docker image ls --quiet --filter "reference=${DEPLOY_PROJECT}-*:latest"
    } | sort -u
  )
  git switch --force-create main "$sha"
  "${compose[@]}" config --quiet
  # One shared runtime image and one web image, both with stable tags.
  "${compose[@]}" build api web
  # A push during the build must wait for its own successful CI instead.
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
  if [[ "$(git rev-parse refs/remotes/origin/main)" != "$sha" ]]; then
    echo "A newer main commit arrived during build; skipping activation."
    return 75
  fi
  # The existing database/Redis and all persistent volumes remain in place.
  "${compose[@]}" run --rm --no-deps migrate
  "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 api worker web
  "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 60 caddy
  "${compose[@]}" exec -T caddy caddy reload --config /etc/cert-app-deploy/Caddyfile --adapter caddyfile
  "${compose[@]}" exec -T api node -e 'fetch("http://127.0.0.1:3001/api/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
  "${compose[@]}" exec -T api pnpm exec tsx -e 'import { renderPdf } from "@cert/renderer/server"; import { createDefaultDocument } from "@cert/contracts"; (async () => { const pdf = await renderPdf({document: createDefaultDocument(), data: {recipient_name:"部署驗證",recipient_email:"deploy@example.test",organization_name:"測試",event_name:"測試",issue_date:"2026-10-16",certificate_number:"DEPLOY-SMOKE"}}); if (pdf.subarray(0,5).toString() !== "%PDF-") throw new Error("Invalid PDF"); console.log("PDF smoke passed:", pdf.length); })();'
  "${compose[@]}" rm --force migrate
  # Remove only replaced images belonging to these application services; never force-remove.
  local old tag
  for old in "${previous[@]}"; do
    [[ -n "$old" ]] || continue
    # A running/stopped container (including another application's) still needs this image.
    [[ -z "$(docker ps --all --quiet --filter "ancestor=$old")" ]] || continue
    while IFS= read -r tag; do
      if [[ "$tag" =~ ^cert-app-production-(api|worker|web|migrate|runtime|create-admin):latest$ ]]; then
        docker image rm "$tag" || true
      fi
    done < <(docker image inspect "$old" --format '{{range .RepoTags}}{{println .}}{{end}}' 2>/dev/null)
    docker image rm "$old" 2>/dev/null || true
  done
  # Covers this application's dangling images from an interrupted/failed earlier build.
  docker image prune --force --filter label=io.cert-app.managed=true
  # This dedicated host uses the default builder: bound unused cache, never prune volumes.
  docker builder prune --force --keep-storage 1GB
  echo "Deployment completed: $sha"
}

main "$@"
