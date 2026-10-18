#!/usr/bin/env bash
# Upload screenshots or videos to one shared secret gist and print (or post) Markdown that
# embeds them. GitHub's own comment attachments need a browser session, so a gh token
# cannot use them; a gist is GitHub-hosted, token-writable, and kept out of the repo.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: upload-pr-media.sh [--pr N] [--repo OWNER/REPO] [--comment] [--title TEXT] [--allow-private] FILE...

  --pr N            Pull request number (default: the PR for the current branch)
  --repo R          Repository (default: the current directory's GitHub repo)
  --comment         Post the Markdown as a PR comment instead of printing it
  --title TEXT      Heading for the posted comment (default: "Screenshots")
  --allow-private   Upload for a private repo anyway (gist URLs are viewable by anyone with the link)
EOF
}

pr=""
repo=""
post_comment=false
title="Screenshots"
allow_private=false
files=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) pr="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    --comment) post_comment=true; shift ;;
    --title) title="$2"; shift 2 ;;
    --allow-private) allow_private=true; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) files+=("$1"); shift ;;
  esac
done

if [[ ${#files[@]} -eq 0 ]]; then
  usage >&2
  exit 2
fi

for file in "${files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Not a file: $file" >&2
    exit 1
  fi
done

if [[ -z "$pr" ]]; then
  if [[ -n "$repo" ]]; then
    echo "--repo needs --pr: the current branch's PR may belong to another repo." >&2
    exit 2
  fi
  # gh infers the PR from the current branch only when --repo is not passed.
  pr=$(gh pr view --json number --jq .number)
fi
if [[ -z "$repo" ]]; then
  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fi

visibility=$(gh api "repos/$repo" --jq .visibility)
if [[ "$visibility" != "public" && "$allow_private" != true ]]; then
  echo "$repo is $visibility. Gist media is viewable by anyone with the link; rerun with --allow-private only if the files hold nothing sensitive." >&2
  exit 1
fi

owner=$(gh api user --jq .login)
# Every PR shares one gist, so file names carry the repo and PR to stay unique.
description="PR media"
gist_id=${PR_MEDIA_GIST_ID:-}
if [[ -z "$gist_id" ]]; then
  # Read every match before picking one: under pipefail, `head` closing the pipe early
  # kills the script. The oldest match wins so a duplicate never takes over the store.
  matches=$(gh api gists --paginate --jq ".[] | select(.description == \"$description\") | \"\(.created_at) \(.id)\"" | sort)
  gist_id=$(awk 'NR == 1 {print $2}' <<<"$matches")
  match_count=$(awk 'NF' <<<"$matches" | wc -l)
  if (( match_count > 1 )); then
    echo "Found $match_count gists described \"$description\"; using the oldest, $gist_id. Set PR_MEDIA_GIST_ID to choose one." >&2
  fi
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [[ -z "$gist_id" ]]; then
  echo "Screenshots and recordings for pull requests, named <owner>-<repo>-<pr>-<file>." > "$work/README.md"
  gist_url=$(gh gist create "$work/README.md" --desc "$description" | tail -1)
  gist_id=${gist_url##*/}
fi

git_auth=(-c credential.helper= -c "credential.helper=!gh auth git-credential")
# The shared gist only grows, so skip its history.
git "${git_auth[@]}" clone --quiet --depth 1 "https://gist.github.com/$gist_id.git" "$work/gist"

prefix=$(echo "$repo" | tr '/' '-')-$pr
names=()
for file in "${files[@]}"; do
  # Gist file names become URL path segments, so keep them to URL-safe characters.
  name=$prefix-$(basename "$file" | tr -c 'A-Za-z0-9._\n-' '-')
  # The guarded expansion keeps macOS bash 3.2 from treating an empty array as unset.
  for existing in ${names[@]+"${names[@]}"}; do
    if [[ "$existing" == "$name" ]]; then
      echo "Two files map to the gist name $name; rename one and rerun." >&2
      exit 2
    fi
  done
  cp "$file" "$work/gist/$name"
  names+=("$name")
done

git -C "$work/gist" add --all
if ! git -C "$work/gist" diff --cached --quiet; then
  git -C "$work/gist" -c user.name="$owner" -c user.email="$owner@users.noreply.github.com" \
    commit --quiet -m "Add media for $repo#$pr"
  git -C "$work/gist" "${git_auth[@]}" push --quiet origin HEAD
fi
sha=$(git -C "$work/gist" rev-parse HEAD)

markdown=""
for name in "${names[@]}"; do
  # Pin to the commit so a later upload with the same name never changes this comment.
  url="https://gist.githubusercontent.com/$owner/$gist_id/raw/$sha/$name"
  status=$(curl -sL -o /dev/null -w "%{http_code}" "$url")
  if [[ "$status" != "200" ]]; then
    echo "Uploaded $name but $url returned $status" >&2
    exit 1
  fi
  label=${name#"$prefix"-}
  label=${label%.*}
  case "${name##*.}" in
    png|PNG|jpg|JPG|jpeg|JPEG|gif|GIF|webp|WEBP)
      markdown+="**$label**"$'\n'"<img alt=\"$label\" src=\"$url\" width=\"800\">"$'\n\n'
      ;;
    *)
      # GitHub only embeds video it hosts as a comment attachment, so link everything else.
      markdown+="[$name]($url)"$'\n\n'
      ;;
  esac
done

if [[ "$post_comment" == true ]]; then
  body="## $title"$'\n\n'"$markdown"
  gh pr comment "$pr" --repo "$repo" --body "$body"
else
  printf '%s' "$markdown"
fi
echo "Gist: https://gist.github.com/$owner/$gist_id" >&2
