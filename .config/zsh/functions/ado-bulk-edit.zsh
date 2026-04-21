function _ado_bulk_edit_log() {
  printf '[ado-bulk-edit] %s\n' "$*"
}

function _ado_bulk_edit_warn() {
  printf '[ado-bulk-edit] WARN: %s\n' "$*" >&2
}

function _ado_bulk_edit_error() {
  printf '[ado-bulk-edit] ERROR: %s\n' "$*" >&2
}

function _ado_bulk_edit_help() {
  cat <<'EOF'
ado-bulk-edit - Bulk edits for Azure DevOps work items

USAGE
  ado-bulk-edit <command> [options]

COMMANDS
  change-parent    Re-parent closed User Stories and Bugs.
  help             Show this help text.

EXAMPLES
  ado-bulk-edit change-parent --source 556067 --target 612345
  ado-bulk-edit change-parent --query b76352d7-2889-467b-b134-d9bb7fd1acca --target 612345
  ado-bulk-edit change-parent --source 556067 --target 612345 --dry-run
  ado-bulk-edit change-parent --source 556067 --target 612345 --yes
EOF
}

function _ado_bulk_edit_change_parent_help() {
  cat <<'EOF'
ado-bulk-edit change-parent - Change the parent Feature for closed User Stories and Bugs

USAGE
  ado-bulk-edit change-parent [OPTIONS]

OPTIONS
  --source <id>
      Source Feature work item ID.
      Mutually exclusive with --query.

  --query <id>
      Azure Boards query ID.
      Mutually exclusive with --source.

  --target <id>
      Target Feature work item ID.

  --dry-run
      Show what would be changed without modifying any work items.

  --yes, -y
      Skip the confirmation prompt.

  -h, --help
      Show this help text.

NOTES
  - Exactly one of --source or --query must be provided.
  - Requires the Azure DevOps CLI extension.
  - Uses the current az devops defaults for organization and project.
  - Only work items with type 'User Story' or 'Bug' and state 'Closed' are changed.
EOF
}

typeset -g _ado_bulk_edit_last_type=""
typeset -g _ado_bulk_edit_last_state=""
typeset -g _ado_bulk_edit_last_title=""
typeset -g _ado_bulk_edit_last_parent=""

function _ado_bulk_edit_fetch_work_item_details() {
  emulate -L zsh
  setopt local_options pipe_fail no_aliases

  local work_item_id="$1"
  local details_output=""
  local -a detail_lines

  details_output=$(az boards work-item show \
    --id "$work_item_id" \
    --only-show-errors \
    --query "[fields.\"System.WorkItemType\", fields.\"System.State\", fields.\"System.Title\", to_string(fields.\"System.Parent\")]" \
    -o tsv)
  if [[ $? -ne 0 ]]; then
    return 1
  fi

  detail_lines=("${(@f)details_output}")

  typeset -g _ado_bulk_edit_last_type="${detail_lines[1]}"
  typeset -g _ado_bulk_edit_last_state="${detail_lines[2]}"
  typeset -g _ado_bulk_edit_last_title="${detail_lines[3]}"
  typeset -g _ado_bulk_edit_last_parent="${detail_lines[4]}"

  if [[ "$_ado_bulk_edit_last_parent" == "null" ]]; then
    typeset -g _ado_bulk_edit_last_parent=""
  fi
}

function _ado_bulk_edit_validate_feature() {
  emulate -L zsh
  setopt local_options no_aliases

  local work_item_id="$1"
  local label="$2"
  local work_item_type=""

  work_item_type=$(az boards work-item show \
    --id "$work_item_id" \
    --only-show-errors \
    --query "fields.\"System.WorkItemType\"" \
    -o tsv)
  if [[ $? -ne 0 ]]; then
    _ado_bulk_edit_error "Failed to load $label work item $work_item_id."
    return 1
  fi

  if [[ "$work_item_type" != "Feature" ]]; then
    _ado_bulk_edit_error "$label work item $work_item_id is '$work_item_type', expected 'Feature'."
    return 1
  fi
}

function _ado_bulk_edit_change_parent() {
  emulate -L zsh
  setopt local_options pipe_fail no_aliases

  local query_id=""
  local source_id=""
  local target_id=""
  local skip_confirmation=false
  local dry_run=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --query)
        if [[ $# -lt 2 || -z "$2" ]]; then
          _ado_bulk_edit_error "--query requires a value."
          return 1
        fi
        query_id="$2"
        shift 2
        ;;
      --source)
        if [[ $# -lt 2 || -z "$2" ]]; then
          _ado_bulk_edit_error "--source requires a value."
          return 1
        fi
        source_id="$2"
        shift 2
        ;;
      --target)
        if [[ $# -lt 2 || -z "$2" ]]; then
          _ado_bulk_edit_error "--target requires a value."
          return 1
        fi
        target_id="$2"
        shift 2
        ;;
      --dry-run)
        dry_run=true
        shift
        ;;
      --yes|-y)
        skip_confirmation=true
        shift
        ;;
      -h|--help)
        _ado_bulk_edit_change_parent_help
        return 0
        ;;
      *)
        _ado_bulk_edit_error "Unknown parameter: $1"
        _ado_bulk_edit_change_parent_help >&2
        return 1
        ;;
    esac
  done

  if [[ -z "$target_id" ]]; then
    _ado_bulk_edit_error "--target is required."
    _ado_bulk_edit_change_parent_help >&2
    return 1
  fi

  if [[ -n "$source_id" && -n "$query_id" ]]; then
    _ado_bulk_edit_error "Use either --source or --query, not both."
    return 1
  fi

  if [[ -z "$source_id" && -z "$query_id" ]]; then
    _ado_bulk_edit_error "Either --source or --query must be provided."
    return 1
  fi

  if [[ -n "$source_id" && ! "$source_id" == <-> ]]; then
    _ado_bulk_edit_error "--source must be a numeric work item ID."
    return 1
  fi

  if [[ ! "$target_id" == <-> ]]; then
    _ado_bulk_edit_error "--target must be a numeric work item ID."
    return 1
  fi

  if ! command -v az >/dev/null 2>&1; then
    _ado_bulk_edit_error "az CLI is not installed or not on PATH."
    return 1
  fi

  if [[ -n "$source_id" ]]; then
    _ado_bulk_edit_log "Validating source feature $source_id..."
    _ado_bulk_edit_validate_feature "$source_id" "Source" || return 1
  fi

  _ado_bulk_edit_log "Validating target feature $target_id..."
  _ado_bulk_edit_validate_feature "$target_id" "Target" || return 1

  if [[ -n "$source_id" && "$source_id" == "$target_id" ]]; then
    _ado_bulk_edit_error "--source and --target must be different feature IDs."
    return 1
  fi

  local ids_output=""
  if [[ -n "$source_id" ]]; then
    local wiql="Select [System.Id] From WorkItems Where [System.Parent] = $source_id And [System.State] = 'Closed' And [System.WorkItemType] In ('User Story', 'Bug')"
    _ado_bulk_edit_log "Loading candidates from source feature $source_id..."
    ids_output=$(az boards query --wiql "$wiql" --only-show-errors --query "[].id" -o tsv)
    if [[ $? -ne 0 ]]; then
      _ado_bulk_edit_error "Failed to load children for source feature $source_id."
      return 1
    fi
  else
    _ado_bulk_edit_log "Loading candidates from query $query_id..."
    ids_output=$(az boards query --id "$query_id" --only-show-errors --query "[].id" -o tsv)
    if [[ $? -ne 0 ]]; then
      _ado_bulk_edit_error "Failed to execute Azure Boards query $query_id."
      return 1
    fi
  fi

  local -a raw_work_item_ids
  raw_work_item_ids=()
  if [[ -n "$ids_output" ]]; then
    raw_work_item_ids=("${(@f)ids_output}")
  fi

  if [[ ${#raw_work_item_ids[@]} -eq 0 ]]; then
    if [[ -n "$source_id" ]]; then
      _ado_bulk_edit_log "No closed User Stories or Bugs found under source feature $source_id."
    else
      _ado_bulk_edit_log "Query $query_id returned no work items."
    fi
    return 0
  fi

  _ado_bulk_edit_log "Inspecting ${#raw_work_item_ids[@]} work items and filtering to closed User Stories and Bugs..."

  local -a candidate_ids candidate_types candidate_states candidate_titles candidate_parents
  local -a filtered_out_ids
  local work_item_id=""
  local work_item_type=""
  local work_item_state=""
  local work_item_title=""
  local current_parent=""

  for work_item_id in "${raw_work_item_ids[@]}"; do
    if ! _ado_bulk_edit_fetch_work_item_details "$work_item_id"; then
      _ado_bulk_edit_warn "Could not load details for work item $work_item_id during inspection. Skipping it."
      filtered_out_ids+=("$work_item_id")
      continue
    fi

    work_item_type="$_ado_bulk_edit_last_type"
    work_item_state="$_ado_bulk_edit_last_state"
    work_item_title="$_ado_bulk_edit_last_title"
    current_parent="$_ado_bulk_edit_last_parent"

    if [[ "$work_item_type" != "User Story" && "$work_item_type" != "Bug" ]]; then
      _ado_bulk_edit_log "Skipping $work_item_id [$work_item_type/$work_item_state] '$work_item_title' because the type is not supported."
      filtered_out_ids+=("$work_item_id")
      continue
    fi

    if [[ "$work_item_state" != "Closed" ]]; then
      _ado_bulk_edit_log "Skipping $work_item_id [$work_item_type/$work_item_state] '$work_item_title' because the state is not Closed."
      filtered_out_ids+=("$work_item_id")
      continue
    fi

    if [[ -n "$source_id" && "$current_parent" != "$source_id" ]]; then
      _ado_bulk_edit_log "Skipping $work_item_id [$work_item_type/$work_item_state] '$work_item_title' because the current parent is ${current_parent:-<none>} instead of source $source_id."
      filtered_out_ids+=("$work_item_id")
      continue
    fi

    candidate_ids+=("$work_item_id")
    candidate_types+=("$work_item_type")
    candidate_states+=("$work_item_state")
    candidate_titles+=("$work_item_title")
    candidate_parents+=("$current_parent")
  done

  if [[ ${#candidate_ids[@]} -eq 0 ]]; then
    _ado_bulk_edit_log "No eligible closed User Stories or Bugs found after filtering."
    return 0
  fi

  _ado_bulk_edit_log "Planned parent changes for ${#candidate_ids[@]} work items:"
  local i=0
  for (( i = 1; i <= ${#candidate_ids[@]}; i++ )); do
    _ado_bulk_edit_log "  [$i/${#candidate_ids[@]}] ${candidate_types[$i]} ${candidate_ids[$i]} | state=${candidate_states[$i]} | current-parent=${candidate_parents[$i]:-<none>} | target-parent=$target_id | title=${candidate_titles[$i]}"
  done

  if [[ ${#filtered_out_ids[@]} -gt 0 ]]; then
    _ado_bulk_edit_log "Filtered out ${#filtered_out_ids[@]} work items: ${filtered_out_ids[*]}"
  fi

  if [[ "$dry_run" == true ]]; then
    _ado_bulk_edit_log "Dry-run enabled. No work items will be modified."
    return 0
  fi

  if [[ "$skip_confirmation" != true ]]; then
    local answer=""
    vared -p "Proceed with changing the parent for ${#candidate_ids[@]} work items? (y/n): " -c answer
    if [[ "$answer" != "y" ]]; then
      _ado_bulk_edit_log "Aborted."
      return 1
    fi
  fi

  local updated_count=0
  local skipped_count=0
  local failed_count=0
  local -a updated_ids skipped_ids failed_ids
  local verified_parent=""

  for (( i = 1; i <= ${#candidate_ids[@]}; i++ )); do
    work_item_id="${candidate_ids[$i]}"
    work_item_type="${candidate_types[$i]}"
    work_item_title="${candidate_titles[$i]}"

    _ado_bulk_edit_log "[$i/${#candidate_ids[@]}] Processing $work_item_type $work_item_id | title=$work_item_title"

    if ! _ado_bulk_edit_fetch_work_item_details "$work_item_id"; then
      _ado_bulk_edit_warn "Failed to reload work item $work_item_id before updating."
      failed_ids+=("$work_item_id")
      ((failed_count++))
      continue
    fi

    current_parent="$_ado_bulk_edit_last_parent"

    if [[ -n "$source_id" && "$current_parent" != "$source_id" ]]; then
      _ado_bulk_edit_warn "Skipping $work_item_id because its current parent is ${current_parent:-<none>} instead of source $source_id."
      skipped_ids+=("$work_item_id")
      ((skipped_count++))
      continue
    fi

    if [[ "$current_parent" == "$target_id" ]]; then
      _ado_bulk_edit_log "Skipping $work_item_id because it is already under target parent $target_id."
      skipped_ids+=("$work_item_id")
      ((skipped_count++))
      continue
    fi

    if [[ -n "$current_parent" ]]; then
      _ado_bulk_edit_log "Removing parent $current_parent from $work_item_id..."
      az boards work-item relation remove \
        --id "$work_item_id" \
        --relation-type parent \
        --target-id "$current_parent" \
        --yes \
        --only-show-errors \
        -o none

      if [[ $? -ne 0 ]]; then
        _ado_bulk_edit_warn "Failed to remove parent $current_parent from $work_item_id."
        failed_ids+=("$work_item_id")
        ((failed_count++))
        continue
      fi
    else
      _ado_bulk_edit_log "$work_item_id currently has no parent relation to remove."
    fi

    _ado_bulk_edit_log "Adding target parent $target_id to $work_item_id..."
    az boards work-item relation add \
      --id "$work_item_id" \
      --relation-type parent \
      --target-id "$target_id" \
      --only-show-errors \
      -o none

    if [[ $? -ne 0 ]]; then
      _ado_bulk_edit_warn "Failed to add target parent $target_id to $work_item_id."
      if [[ -n "$current_parent" ]]; then
        _ado_bulk_edit_warn "$work_item_id no longer has its previous parent $current_parent. Manual remediation may be required."
      fi
      failed_ids+=("$work_item_id")
      ((failed_count++))
      continue
    fi

    verified_parent=$(az boards work-item show \
      --id "$work_item_id" \
      --only-show-errors \
      --query "fields.\"System.Parent\"" \
      -o tsv)

    if [[ $? -ne 0 ]]; then
      _ado_bulk_edit_warn "Updated $work_item_id, but failed to verify the new parent."
      failed_ids+=("$work_item_id")
      ((failed_count++))
      continue
    fi

    if [[ "$verified_parent" != "$target_id" ]]; then
      _ado_bulk_edit_warn "Verification failed for $work_item_id. Expected parent $target_id, got ${verified_parent:-<none>}."
      failed_ids+=("$work_item_id")
      ((failed_count++))
      continue
    fi

    _ado_bulk_edit_log "Updated $work_item_id successfully: ${current_parent:-<none>} -> $target_id"
    updated_ids+=("$work_item_id")
    ((updated_count++))
  done

  _ado_bulk_edit_log "Summary: updated=$updated_count skipped=$skipped_count failed=$failed_count"

  if [[ ${#updated_ids[@]} -gt 0 ]]; then
    _ado_bulk_edit_log "Updated IDs: ${updated_ids[*]}"
  fi

  if [[ ${#skipped_ids[@]} -gt 0 ]]; then
    _ado_bulk_edit_log "Skipped IDs: ${skipped_ids[*]}"
  fi

  if [[ ${#failed_ids[@]} -gt 0 ]]; then
    _ado_bulk_edit_log "Failed IDs: ${failed_ids[*]}"
  fi

  if [[ $failed_count -gt 0 ]]; then
    return 1
  fi
}

function ado-bulk-edit() {
  emulate -L zsh
  setopt local_options no_aliases

  local command="${1:-help}"
  shift || true

  case "$command" in
    change-parent)
      _ado_bulk_edit_change_parent "$@"
      ;;
    help|-h|--help)
      _ado_bulk_edit_help
      ;;
    *)
      _ado_bulk_edit_error "Unknown command: $command"
      _ado_bulk_edit_help >&2
      return 1
      ;;
  esac
}
