alias outdated='dotnet outdated -exc Roslynator -exc CSharpier'
alias outdated-update='outdated -inc P0. -u && outdated -u -vl Major'
alias dfs='dotnet format style'

function dotnet() {
  if [[ "$1" == "--wrapper-help" ]]; then
    cat <<'EOF'
Usage: dotnet [dotnet-args...]
       dotnet --wrapper-help

This zsh wrapper adds project discovery before delegating to the real .NET
CLI through 1Password.

Wrapper behavior:
  1. Resolve the working directory for dotnet:
     - prefer the current directory if it contains a .sln, .slnx, or project file
     - otherwise scan src/v1, src/v2, ... and use the highest matching version

  2. Resolve op:// environment variables for the dotnet subprocess:
     - non-interactive runs behave like `O dotnet ...`
     - interactive terminal runs behave like `OM dotnet ...` to preserve a
       real TTY so ANSI/Camunda console highlighting keeps working

Notes:
  - Native .NET CLI help is unchanged: use `dotnet --help`
  - Wrapper help is available via: `dotnet --wrapper-help`
EOF
    return 0
  fi

  local -a current_matches
  local -a v1_matches
  local -a version_matches
  local target_dir=""
  local highest_version=-1
  local version_dir
  local version_name
  local version_number
  local -a op_run_args

  # Assumption: project/solution detection is non-recursive and only checks
  # the current directory or direct src/v* version folders, matching the
  # user's "current folder" / "src/v1, src/v2, ..." requirement.
  current_matches=( *.sln(N) *.slnx(N) *.csproj(N) *.fsproj(N) *.vbproj(N) )

  if [[ ${#current_matches[@]} -gt 0 ]]; then
    target_dir="."
  else
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
  fi

  (
    if [[ -n "$target_dir" && "$target_dir" != "." ]]; then
      cd "$target_dir" || exit 1
    fi

    # 1Password's default stdout/stderr masking can make child processes think
    # output is redirected, which disables ANSI/log highlighting in interactive
    # console apps. Use O-style behavior for non-interactive usage, but switch
    # to OM-style behavior for terminal runs so Camunda/.NET highlighting stays.
    op_run_args=( run -- )

    if [[ -t 1 && -t 2 ]]; then
      op_run_args=( run --no-masking -- )
    fi

    command op "${op_run_args[@]}" dotnet "$@"
  )

  return $?
}
