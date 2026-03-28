function dotnet() {
  local -a current_matches
  local -a v1_matches
  local -a version_matches
  local target_dir=""
  local highest_version=-1
  local version_dir
  local version_name
  local version_number

  # Assumption: project/solution detection is non-recursive and only checks
  # the current directory or direct src/v* version folders, matching the
  # user's "current folder" / "src/v1, src/v2, ..." requirement.
  current_matches=( *.sln(N) *.slnx(N) *.csproj(N) *.fsproj(N) *.vbproj(N) )

  if [[ ${#current_matches[@]} -gt 0 ]]; then
    command dotnet "$@"
    return $?
  fi

  v1_matches=( src/v1/*.sln(N) src/v1/*.slnx(N) src/v1/*.csproj(N) src/v1/*.fsproj(N) src/v1/*.vbproj(N) )

  if [[ ${#v1_matches[@]} -gt 0 ]]; then
    target_dir="src/v1"
    highest_version=1
  fi

  for version_dir in src/v<->(N/); do
    version_matches=( "$version_dir"/*.sln(N) "$version_dir"/*.slnx(N) "$version_dir"/*.csproj(N) "$version_dir"/*.fsproj(N) "$version_dir"/*.vbproj(N) )

    if [[ ${#version_matches[@]} -eq 0 ]]; then
      continue
    fi

    version_name="${version_dir:t}"
    version_number="${version_name#v}"

    if (( version_number > highest_version )); then
      highest_version=$version_number
      target_dir="$version_dir"
    fi
  done

  if [[ -n "$target_dir" ]]; then
    (
      cd "$target_dir" || exit 1
      command dotnet "$@"
    )
    return $?
  fi

  command dotnet "$@"
}
