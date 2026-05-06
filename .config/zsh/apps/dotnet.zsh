function dotnet() {
  local -a current_matches
  local -a v1_matches
  local -a version_matches
  local target_dir=""
  local highest_version=-1
  local version_dir
  local version_name
  local version_number
  local -a project_files
  local -a secrets_ids
  local project_file
  local extracted_secrets_id
  local secrets_id=""
  local secrets_dir=""
  local secrets_template=""
  local secrets_file=""
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

    # Assumption: inject only when the selected project tree resolves to one
    # unique UserSecretsId. If none or multiple are present, skip injection
    # rather than guessing the wrong secrets file.
    if [[ -n "$target_dir" ]]; then
      project_files=( **/*.csproj(N) **/*.fsproj(N) **/*.vbproj(N) )
      secrets_ids=()

      for project_file in "${project_files[@]}"; do
        extracted_secrets_id=$(sed -n 's:.*<UserSecretsId>\([^<][^<]*\)</UserSecretsId>.*:\1:p' "$project_file" | head -n 1)

        if [[ -n "$extracted_secrets_id" ]]; then
          secrets_ids+=( "$extracted_secrets_id" )
        fi
      done

      secrets_ids=( "${(@u)secrets_ids}" )

      if [[ ${#secrets_ids[@]} -eq 1 ]]; then
        secrets_id="$secrets_ids[1]"
        secrets_dir="$HOME/.microsoft/usersecrets/$secrets_id"
        secrets_template="$secrets_dir/secrets.tpl.json"
        secrets_file="$secrets_dir/secrets.json"

        if [[ -f "$secrets_template" ]]; then
          trap 'rm -f "$secrets_file"' EXIT
          trap 'rm -f "$secrets_file"; exit 1' HUP INT QUIT TERM

          command op inject -f -i "$secrets_template" -o "$secrets_file" || exit 1
          chmod 600 "$secrets_file" || exit 1
        fi
      fi
    fi

    # 1Password's default stdout/stderr masking can make child processes think
    # output is redirected, which disables ANSI/log highlighting in interactive
    # console apps. Keep masking for non-interactive usage, but preserve a real
    # TTY for terminal runs so Camunda/.NET console highlighting still works.
    op_run_args=( run -- )

    if [[ -t 1 && -t 2 ]]; then
      op_run_args=( run --no-masking -- )
    fi

    command op "${op_run_args[@]}" dotnet "$@"
  )

  return $?
}
