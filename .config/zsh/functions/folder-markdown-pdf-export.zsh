folder-markdown-pdf-export() {
  emulate -L zsh
  setopt local_options local_traps nounset
  trap _cleanup_temp EXIT


SCRIPT_NAME="folder-markdown-pdf-export"
INDEX_FILENAME=".export-index.json"

INPUT_PATH=""
OUTPUT_PATH=""
IGNORE_PATHS=()
EFFECTIVE_INPUT=""
EFFECTIVE_OUTPUT=""
INDEX_FILE=""
INDEX_WORK_FILE=""
TEMP_DIR=""
DEFAULT_CSS_FILE=""
SOURCE_MANIFEST=""
OUTPUT_MANIFEST=""
INPUT_FIND_RESULTS=""
OUTPUT_FIND_RESULTS=""
IGNORED_FILE_MANIFEST=""
IGNORED_DIR_MANIFEST=""
COLLISION_MAP_MANIFEST=""
COLLISION_MANIFEST=""
COLLISION_SOURCE_MANIFEST=""
FAILED_MANIFEST=""
HASH_TOOL=""
LAST_FAILURE_MESSAGE=""
CONVERTED_COUNT=0
COPIED_COUNT=0
SKIPPED_COUNT=0
FAILED_COUNT=0
COLLISION_SKIPPED_COUNT=0
ORPHANED_COUNT=0
PUBLISH_ATTEMPT_COUNT=0

_show_help() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [OPTIONS]

DESCRIPTION
  Recursively mirrors an input folder into an output folder.
  Markdown files (*.md) are converted to PDF with pandoc + weasyprint.
  All other files are copied as-is.

OPTIONS
  -i, --input <path>
      Input folder to export.
      Defaults to WIKI_HOME when omitted.

  -o, --output <path>
      Output folder.
      Defaults to a sibling of the effective input folder named
      <input-basename>-pdf.
      Example: ./Docs/Notes -> ./Docs/Notes-pdf

  --ignore <path>
      Exclude a file or folder relative to the effective input root.
      May be supplied multiple times.
      Any folder named .git is ignored recursively by default.

  -h, --help
      Show this help text and exit.

ENVIRONMENT
  WIKI_HOME
      Default input folder when --input is not supplied.

EXAMPLES
  # Explicit input and output
  ${SCRIPT_NAME} --input ./Docs/Notes --output ./Exports/Notes-pdf

  # Output derived from input
  ${SCRIPT_NAME} -i ./Docs/Notes

  # Both defaults via WIKI_HOME
  WIKI_HOME=/Users/me/Notes ${SCRIPT_NAME}

  # Exclude draft content and temp folders
  ${SCRIPT_NAME} --input ./Docs/Notes --ignore drafts/todo.md --ignore tmp

NOTES
  - Positional arguments are not supported; use named parameters.
  - The output root keeps an index file at <output>/${INDEX_FILENAME}.
  - Mermaid fences are left as ordinary code blocks.
  - Any folder named .git is ignored automatically.
EOF
}

_error() {
  echo "[${SCRIPT_NAME}] ERROR: $1" >&2
}

_log_status() {
  local action="$1"
  local path_value="$2"
  local detail="${3:-}"

  if [[ -n "$detail" ]]; then
    printf '[%s] %s -- %s\n' "$action" "$path_value" "$detail" >&2
  else
    printf '[%s] %s\n' "$action" "$path_value" >&2
  fi
}

_print_collision_groups() {
  if [[ ! -s "$COLLISION_MANIFEST" ]]; then
    return 0
  fi

  printf '\nCollisions:\n' >&2
  awk -F '\t' '{
    printf "  %s <- ", $1
    for (i = 2; i <= NF; i++) {
      printf "%s", $i
      if (i < NF) {
        printf ", "
      }
    }
    printf "\n"
  }' "$COLLISION_MANIFEST" >&2
}

_print_summary() {
  local failed_path

  printf '\n=== Summary ===\n' >&2
  printf 'Converted:         %s\n' "$CONVERTED_COUNT" >&2
  printf 'Copied:            %s\n' "$COPIED_COUNT" >&2
  printf 'Skipped:           %s\n' "$SKIPPED_COUNT" >&2
  printf 'Failed:            %s\n' "$FAILED_COUNT" >&2
  printf 'Collision-skipped: %s\n' "$COLLISION_SKIPPED_COUNT" >&2
  printf 'Orphaned:          %s\n' "$ORPHANED_COUNT" >&2

  if [[ $FAILED_COUNT -gt 0 ]]; then
    printf '\nFailed files:\n' >&2
    while IFS= read -r failed_path; do
      if [[ -n "$failed_path" ]]; then
        printf '  %s\n' "$failed_path" >&2
      fi
    done < "$FAILED_MANIFEST"
  fi

  _print_collision_groups
}

_read_log_snippet() {
  local log_path="$1"

  awk 'NF { print; exit }' "$log_path" 2>/dev/null
}

_record_failed_file() {
  local source_relative_path="$1"
  local detail="${2:-processing failed}"

  printf '%s\n' "$source_relative_path" >> "$FAILED_MANIFEST" || {
    _error "Failed to record failed file: $source_relative_path"
    return 1
  }

  FAILED_COUNT=$((FAILED_COUNT + 1))
  _log_status "FAIL" "$source_relative_path" "$detail"
  return 0
}

_check_dependencies() {
  local missing_deps=()

  command -v pandoc >/dev/null 2>&1 || missing_deps+=("pandoc")
  command -v weasyprint >/dev/null 2>&1 || missing_deps+=("weasyprint")
  command -v jq >/dev/null 2>&1 || missing_deps+=("jq")
  command -v find >/dev/null 2>&1 || missing_deps+=("find")
  command -v mkdir >/dev/null 2>&1 || missing_deps+=("mkdir")
  command -v cp >/dev/null 2>&1 || missing_deps+=("cp")
  command -v mv >/dev/null 2>&1 || missing_deps+=("mv")
  command -v rm >/dev/null 2>&1 || missing_deps+=("rm")
  command -v mktemp >/dev/null 2>&1 || missing_deps+=("mktemp")
  command -v dirname >/dev/null 2>&1 || missing_deps+=("dirname")
  command -v basename >/dev/null 2>&1 || missing_deps+=("basename")
  command -v grep >/dev/null 2>&1 || missing_deps+=("grep")
  command -v awk >/dev/null 2>&1 || missing_deps+=("awk")
  command -v sort >/dev/null 2>&1 || missing_deps+=("sort")

  if command -v shasum >/dev/null 2>&1; then
    HASH_TOOL="shasum"
  elif command -v sha256sum >/dev/null 2>&1; then
    HASH_TOOL="sha256sum"
  else
    missing_deps+=("shasum or sha256sum")
  fi

  if [[ ${#missing_deps[@]} -gt 0 ]]; then
    _error "Missing required dependencies: ${missing_deps[*]}"
    return 1
  fi

  return 0
}

_cleanup_temp() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}

_parse_arguments() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -i|--input)
        if [[ $# -lt 2 ]]; then
          _error "$1 requires a value."
          return 1
        fi
        _require_path_option_value "$1" "$2" || return 1
        INPUT_PATH="$2"
        shift 2
        ;;
      -o|--output)
        if [[ $# -lt 2 ]]; then
          _error "$1 requires a value."
          return 1
        fi
        _require_path_option_value "$1" "$2" || return 1
        OUTPUT_PATH="$2"
        shift 2
        ;;
      --ignore)
        if [[ $# -lt 2 ]]; then
          _error "$1 requires a value."
          return 1
        fi
        _require_path_option_value "$1" "$2" || return 1
        IGNORE_PATHS+=("$2")
        shift 2
        ;;
      -h|--help)
        _show_help
        return 2
        ;;
      --)
        shift
        if [[ $# -gt 0 ]]; then
          _error "Positional arguments are not supported; use named parameters."
          return 1
        fi
        ;;
      -* )
        _error "Unknown option: $1"
        return 1
        ;;
      *)
        _error "Positional arguments are not supported; use named parameters."
        return 1
        ;;
    esac
  done

  return 0
}

_trim_trailing_slashes() {
  local value="$1"

  while [[ -n "$value" && "$value" != "/" && "$value" == */ ]]; do
    value=${value%/}
  done

  printf '%s\n' "$value"
}

_is_flag_like_value() {
  local value="$1"

  [[ -n "$value" && "$value" == -* ]]
}

_require_path_option_value() {
  local option_name="$1"
  local option_value="$2"

  if [[ -z "$option_value" ]]; then
    _error "$option_name requires a value."
    return 1
  fi

  if _is_flag_like_value "$option_value"; then
    _error "$option_name requires a path value; got option-like token: $option_value"
    return 1
  fi

  return 0
}

_path_starts_with_literal() {
  local path_value="$1"
  local literal_prefix="$2"

  if [[ ${#path_value} -lt ${#literal_prefix} ]]; then
    return 1
  fi

  [[ "${path_value:0:${#literal_prefix}}" == "$literal_prefix" ]]
}

_path_is_nested_under() {
  local path_value
  local root_value
  local root_prefix

  path_value=$(_trim_trailing_slashes "$1")
  root_value=$(_trim_trailing_slashes "$2")

  if [[ "$root_value" == "/" ]]; then
    root_prefix="/"
  else
    root_prefix="${root_value}/"
  fi

  _path_starts_with_literal "$path_value" "$root_prefix"
}

_relative_path_from_root() {
  local path_value="$1"
  local root_value
  local root_prefix

  root_value=$(_trim_trailing_slashes "$2")

  if [[ "$root_value" == "/" ]]; then
    root_prefix="/"
  else
    root_prefix="${root_value}/"
  fi

  if ! _path_starts_with_literal "$path_value" "$root_prefix"; then
    _error "Failed to derive relative path from root: $path_value"
    return 1
  fi

  printf '%s\n' "${path_value:${#root_prefix}}"
}

_normalize_relative_path() {
  local raw_value="$1"
  local trimmed_value
  local segment
  local joined_value=""
  local old_ifs="$IFS"
  local -a raw_segments=()
  local -a normalized_segments=()

  trimmed_value=$(_trim_trailing_slashes "$raw_value")

  IFS='/'
  read -rA raw_segments <<< "$trimmed_value"
  IFS="$old_ifs"

  for segment in "${raw_segments[@]}"; do
    case "$segment" in
      ""|".")
        ;;
      "..")
        if [[ ${#normalized_segments[@]} -gt 0 ]]; then
          unset 'normalized_segments[-1]'
          normalized_segments=("${normalized_segments[@]}")
        else
          normalized_segments+=("..")
        fi
        ;;
      *)
        normalized_segments+=("$segment")
        ;;
    esac
  done

  if [[ ${#normalized_segments[@]} -eq 0 ]]; then
    printf '.\n'
    return 0
  fi

  for segment in "${normalized_segments[@]}"; do
    if [[ -n "$joined_value" ]]; then
      joined_value="${joined_value}/"
    fi
    joined_value="${joined_value}${segment}"
  done

  printf '%s\n' "$joined_value"
}

_input_path_for_relative_path() {
  local relative_path="$1"

  if [[ -z "$relative_path" || "$relative_path" == "." ]]; then
    printf '%s\n' "$EFFECTIVE_INPUT"
  else
    printf '%s/%s\n' "$EFFECTIVE_INPUT" "$relative_path"
  fi
}

_append_manifest_line() {
  local manifest_path="$1"
  local line_value="$2"
  local manifest_label="$3"

  printf '%s\n' "$line_value" >> "$manifest_path" || {
    _error "Failed to record ${manifest_label}: $line_value"
    return 1
  }

  return 0
}

_resolve_ignore_manifests() {
  local raw_ignore_path
  local normalized_ignore_path
  local candidate_path

  for raw_ignore_path in "${IGNORE_PATHS[@]}"; do
    if [[ "$raw_ignore_path" == /* ]]; then
      continue
    fi

    normalized_ignore_path=$(_normalize_relative_path "$raw_ignore_path")

    if [[ "$normalized_ignore_path" == ".." || "$normalized_ignore_path" == ../* ]]; then
      continue
    fi

    candidate_path=$(_input_path_for_relative_path "$normalized_ignore_path")

    if [[ -d "$candidate_path" ]]; then
      _append_manifest_line "$IGNORED_DIR_MANIFEST" "$normalized_ignore_path" "ignored directory manifest entry" || return 1
    elif [[ -f "$candidate_path" ]]; then
      _append_manifest_line "$IGNORED_FILE_MANIFEST" "$normalized_ignore_path" "ignored file manifest entry" || return 1
    fi
  done

  return 0
}

_resolve_effective_input() {
  local candidate="$INPUT_PATH"

  if [[ -z "$candidate" ]]; then
    if [[ -z "$WIKI_HOME" ]]; then
      _error "WIKI_HOME is not set. Set WIKI_HOME or pass --input."
      return 1
    fi
    candidate="$WIKI_HOME"
  fi

  candidate=$(_trim_trailing_slashes "$candidate")

  if [[ ! -d "$candidate" ]]; then
    _error "Input directory does not exist or is not a directory: $candidate"
    return 1
  fi

  EFFECTIVE_INPUT="$candidate"
  return 0
}

_derive_default_output() {
  local input_path="$1"
  local parent_dir
  local base_name

  input_path=$(_trim_trailing_slashes "$input_path")
  parent_dir=$(dirname "$input_path")
  base_name=$(basename "$input_path")

  if [[ "$parent_dir" == "/" ]]; then
    printf '/%s-pdf\n' "$base_name"
  else
    printf '%s/%s-pdf\n' "$parent_dir" "$base_name"
  fi
}

_resolve_effective_output() {
  local candidate="$OUTPUT_PATH"

  if [[ -z "$candidate" ]]; then
    candidate=$(_derive_default_output "$EFFECTIVE_INPUT") || return 1
  fi

  candidate=$(_trim_trailing_slashes "$candidate")

  if [[ "$candidate" == "$EFFECTIVE_INPUT" ]]; then
    _error "Output directory must differ from the input directory."
    return 1
  fi

  EFFECTIVE_OUTPUT="$candidate"
  return 0
}

_setup_temp_dir() {
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/${SCRIPT_NAME}.XXXXXX" 2>/dev/null)

  if [[ -z "$TEMP_DIR" || ! -d "$TEMP_DIR" ]]; then
    _error "Failed to create a temporary working directory."
    return 1
  fi

  DEFAULT_CSS_FILE="$TEMP_DIR/default.css"
  SOURCE_MANIFEST="$TEMP_DIR/source-manifest.txt"
  OUTPUT_MANIFEST="$TEMP_DIR/output-manifest.txt"
  INPUT_FIND_RESULTS="$TEMP_DIR/input-find-results.txt"
  OUTPUT_FIND_RESULTS="$TEMP_DIR/output-find-results.txt"
  IGNORED_FILE_MANIFEST="$TEMP_DIR/ignored-file-manifest.txt"
  IGNORED_DIR_MANIFEST="$TEMP_DIR/ignored-dir-manifest.txt"
  COLLISION_MAP_MANIFEST="$TEMP_DIR/collision-map-manifest.txt"
  COLLISION_MANIFEST="$TEMP_DIR/collision-manifest.txt"
  COLLISION_SOURCE_MANIFEST="$TEMP_DIR/collision-source-manifest.txt"
  FAILED_MANIFEST="$TEMP_DIR/failed-manifest.txt"

  : > "$SOURCE_MANIFEST" || return 1
  : > "$OUTPUT_MANIFEST" || return 1
  : > "$INPUT_FIND_RESULTS" || return 1
  : > "$OUTPUT_FIND_RESULTS" || return 1
  : > "$IGNORED_FILE_MANIFEST" || return 1
  : > "$IGNORED_DIR_MANIFEST" || return 1
  : > "$COLLISION_MAP_MANIFEST" || return 1
  : > "$COLLISION_MANIFEST" || return 1
  : > "$COLLISION_SOURCE_MANIFEST" || return 1
  : > "$FAILED_MANIFEST" || return 1

  return 0
}

_write_default_css() {
  cat <<'EOF' > "$DEFAULT_CSS_FILE"
@page {
  margin: 18mm 16mm;
}

html {
  color: #1f2933;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11pt;
  line-height: 1.45;
}

body {
  max-width: none;
}

h1, h2, h3, h4, h5, h6 {
  color: #102a43;
  margin-top: 1.3em;
  margin-bottom: 0.4em;
}

p, li {
  orphans: 3;
  widows: 3;
}

pre, code {
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
}

pre {
  background: #f3f5f7;
  border: 1px solid #d9e2ec;
  border-radius: 6px;
  padding: 0.8em;
  overflow: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

code {
  background: #f3f5f7;
  padding: 0.1em 0.25em;
  border-radius: 4px;
}

a {
  color: #0b69a3;
}

blockquote {
  border-left: 4px solid #bcccdc;
  color: #486581;
  margin-left: 0;
  padding-left: 1em;
}
EOF
}

_initialize_output_state() {
  mkdir -p "$EFFECTIVE_OUTPUT" || {
    _error "Failed to create output directory: $EFFECTIVE_OUTPUT"
    return 1
  }

  INDEX_FILE="$EFFECTIVE_OUTPUT/$INDEX_FILENAME"
  INDEX_WORK_FILE="$TEMP_DIR/export-index-work.json"

  if [[ -f "$INDEX_FILE" ]]; then
    if ! jq empty "$INDEX_FILE" >/dev/null 2>&1; then
      _error "Index file is not valid JSON: $INDEX_FILE"
      return 1
    fi

    cp "$INDEX_FILE" "$INDEX_WORK_FILE" || {
      _error "Failed to prepare working index file."
      return 1
    }
  else
    printf '{}\n' > "$INDEX_WORK_FILE" || {
      _error "Failed to initialize working index file."
      return 1
    }
  fi

  return 0
}

_prepare_output_rollback() {
  local output_path="$1"
  local backup_path_var_name="$2"
  local backup_state_var_name="$3"
  local backup_path=""

  if [[ -f "$output_path" ]]; then
    backup_path=$(mktemp "${TEMP_DIR}/output-rollback.XXXXXX") || {
      _error "Failed to create output rollback snapshot for: $output_path"
      return 1
    }

    if ! cp "$output_path" "$backup_path"; then
      rm -f "$backup_path"
      _error "Failed to capture output rollback snapshot for: $output_path"
      return 1
    fi

    printf -v "$backup_state_var_name" '%s' "present"
    printf -v "$backup_path_var_name" '%s' "$backup_path"
  else
    printf -v "$backup_state_var_name" '%s' "missing"
    printf -v "$backup_path_var_name" '%s' ""
  fi

  return 0
}

_prepare_index_work_rollback() {
  local backup_path_var_name="$1"
  local backup_path

  backup_path=$(mktemp "${TEMP_DIR}/index-rollback.XXXXXX") || {
    _error "Failed to create index rollback snapshot."
    return 1
  }

  if ! cp "$INDEX_WORK_FILE" "$backup_path"; then
    rm -f "$backup_path"
    _error "Failed to capture index rollback snapshot."
    return 1
  fi

  printf -v "$backup_path_var_name" '%s' "$backup_path"
  return 0
}

_restore_index_work_rollback() {
  local backup_path="$1"

  if [[ -z "$backup_path" ]]; then
    return 0
  fi

  if ! cp "$backup_path" "$INDEX_WORK_FILE"; then
    _error "Failed to restore working index rollback snapshot."
    return 1
  fi

  return 0
}

_prune_empty_output_dirs_from() {
  local current_dir

  current_dir=$(_trim_trailing_slashes "$1")

  while [[ -n "$current_dir" && "$current_dir" != "$EFFECTIVE_OUTPUT" ]]; do
    if ! rmdir "$current_dir" >/dev/null 2>&1; then
      break
    fi

    current_dir=$(_trim_trailing_slashes "$(dirname "$current_dir")")
  done

  return 0
}

_restore_output_rollback() {
  local output_path="$1"
  local backup_path="$2"
  local backup_state="$3"
  local output_dir

  output_dir=$(dirname "$output_path")

  case "$backup_state" in
    present)
      mkdir -p "$output_dir" || {
        _error "Failed to recreate output directory during rollback: $output_dir"
        return 1
      }

      if ! cp "$backup_path" "$output_path"; then
        _error "Failed to restore output file during rollback: $output_path"
        return 1
      fi
      ;;
    missing)
      if ! rm -f "$output_path"; then
        _error "Failed to remove rolled-back output file: $output_path"
        return 1
      fi

      _prune_empty_output_dirs_from "$output_dir" || return 1
      ;;
    *)
      _error "Unknown output rollback state for: $output_path"
      return 1
      ;;
  esac

  return 0
}

_rollback_output_and_index_change() {
  local output_path="$1"
  local output_backup_path="$2"
  local output_backup_state="$3"
  local index_backup_path="$4"
  local rollback_status=0

  _restore_index_work_rollback "$index_backup_path" || rollback_status=1
  _restore_output_rollback "$output_path" "$output_backup_path" "$output_backup_state" || rollback_status=1

  if [[ $rollback_status -ne 0 ]]; then
    _error "Rollback failed after index publication error for: $output_path"
    return 1
  fi

  return 0
}

_hash_file() {
  local file_path="$1"

  if [[ "$HASH_TOOL" == "shasum" ]]; then
    shasum -a 256 "$file_path" | awk '{print $1}'
  else
    sha256sum "$file_path" | awk '{print $1}'
  fi
}

_relative_output_path_for_source() {
  local source_relative_path="$1"

  case "$source_relative_path" in
    *.md)
      printf '%s\n' "${source_relative_path%.md}.pdf"
      ;;
    *)
      printf '%s\n' "$source_relative_path"
      ;;
  esac
}

_record_live_output_path() {
  local output_relative_path="$1"

  if grep -Fx -- "$output_relative_path" "$OUTPUT_MANIFEST" >/dev/null 2>&1; then
    return 0
  fi

  printf '%s\n' "$output_relative_path" >> "$OUTPUT_MANIFEST" || {
    _error "Failed to record live output manifest entry: $output_relative_path"
    return 1
  }

  return 0
}

_source_has_preserved_output_state() {
  local source_relative_path="$1"
  local output_path="$2"

  if [[ ! -f "$output_path" ]]; then
    return 1
  fi

  jq -e --arg key "$source_relative_path" 'has($key)' "$INDEX_WORK_FILE" >/dev/null 2>&1
}

_build_collision_manifests() {
  local sorted_collision_map="$TEMP_DIR/collision-map-sorted.txt"

  : > "$COLLISION_MANIFEST" || {
    _error "Failed to reset collision manifest."
    return 1
  }

  : > "$COLLISION_SOURCE_MANIFEST" || {
    _error "Failed to reset collision source manifest."
    return 1
  }

  if [[ ! -s "$COLLISION_MAP_MANIFEST" ]]; then
    return 0
  fi

  if ! sort -t $'\t' -k1,1 -k2,2 "$COLLISION_MAP_MANIFEST" > "$sorted_collision_map"; then
    _error "Failed to sort collision mappings."
    return 1
  fi

  if ! awk -F '\t' '
    function flush_group(    item_count, items, i) {
      if (group_count > 1) {
        printf "%s", group_output >> group_file
        item_count = split(group_sources, items, /\n/)
        for (i = 1; i <= item_count; i++) {
          if (items[i] == "") {
            continue
          }
          printf "\t%s", items[i] >> group_file
          print items[i] >> source_file
        }
        printf "\n" >> group_file
      }
    }
    {
      if (group_output != "" && $1 != group_output) {
        flush_group()
        group_count = 0
        group_sources = ""
      }
      if ($1 != group_output) {
        group_output = $1
      }
      group_count++
      if (group_sources == "") {
        group_sources = $2
      } else {
        group_sources = group_sources "\n" $2
      }
    }
    END {
      if (group_output != "") {
        flush_group()
      }
    }
  ' group_file="$COLLISION_MANIFEST" source_file="$COLLISION_SOURCE_MANIFEST" "$sorted_collision_map"; then
    _error "Failed to build collision manifests."
    return 1
  fi

  return 0
}

_log_detected_collisions() {
  if [[ ! -s "$COLLISION_MANIFEST" ]]; then
    return 0
  fi

  awk -F '\t' '{
    printf "[COLLISION] %s -- ", $1
    for (i = 2; i <= NF; i++) {
      printf "%s", $i
      if (i < NF) {
        printf ", "
      }
    }
    printf " (skipping all colliding sources)\n"
  }' "$COLLISION_MANIFEST" >&2
}

_source_is_collision_skipped() {
  local source_relative_path="$1"

  grep -Fx -- "$source_relative_path" "$COLLISION_SOURCE_MANIFEST" >/dev/null 2>&1
}

_collect_input_manifests() {
  local source_path
  local source_relative_path
  local output_relative_path
  local ignored_dir_relative_path
  local ignored_dir_path
  local ignored_file_relative_path
  local ignored_file_path
  local -a find_args=()

  find_args=("$EFFECTIVE_INPUT" "(" "-type" "d" "-name" ".git")

  if _path_is_nested_under "$EFFECTIVE_OUTPUT" "$EFFECTIVE_INPUT"; then
    find_args+=("-o" "-path" "$EFFECTIVE_OUTPUT")
  fi

  while IFS= read -r ignored_dir_relative_path; do
    if [[ -z "$ignored_dir_relative_path" ]]; then
      continue
    fi

    ignored_dir_path=$(_input_path_for_relative_path "$ignored_dir_relative_path")
    find_args+=("-o" "-path" "$ignored_dir_path")
  done < "$IGNORED_DIR_MANIFEST"

  find_args+=(")" "-prune" "-o" "(" "-type" "f")

  while IFS= read -r ignored_file_relative_path; do
    if [[ -z "$ignored_file_relative_path" ]]; then
      continue
    fi

    ignored_file_path=$(_input_path_for_relative_path "$ignored_file_relative_path")
    find_args+=("!" "-path" "$ignored_file_path")
  done < "$IGNORED_FILE_MANIFEST"

  find_args+=("-print0" ")")

  if ! find "${find_args[@]}" > "$INPUT_FIND_RESULTS"; then
    _error "Failed to traverse input directory: $EFFECTIVE_INPUT"
    return 1
  fi

  while IFS= read -r -d '' source_path; do
    source_relative_path=$(_relative_path_from_root "$source_path" "$EFFECTIVE_INPUT") || return 1
    output_relative_path=$(_relative_output_path_for_source "$source_relative_path")

    printf '%s\n' "$source_relative_path" >> "$SOURCE_MANIFEST" || {
      _error "Failed to record source manifest entry: $source_relative_path"
      return 1
    }

    printf '%s\t%s\n' "$output_relative_path" "$source_relative_path" >> "$COLLISION_MAP_MANIFEST" || {
      _error "Failed to record collision manifest entry: $source_relative_path"
      return 1
    }
  done < "$INPUT_FIND_RESULTS"

  _build_collision_manifests || return 1
  _log_detected_collisions || return 1
  return 0
}

_get_index_input_hash() {
  local source_relative_path="$1"

  jq -r --arg key "$source_relative_path" '.[$key].input_hash // empty' "$INDEX_WORK_FILE"
}

_get_index_output_hash() {
  local source_relative_path="$1"

  jq -r --arg key "$source_relative_path" '.[$key].output_hash // empty' "$INDEX_WORK_FILE"
}

_upsert_index_entry() {
  local source_relative_path="$1"
  local input_hash="$2"
  local output_hash="$3"
  local temp_index_file

  temp_index_file=$(mktemp "${TEMP_DIR}/index-update.XXXXXX") || {
    _error "Failed to create a temporary index file."
    return 1
  }

  if ! jq \
    --arg key "$source_relative_path" \
    --arg input_hash "$input_hash" \
    --arg output_hash "$output_hash" \
    '.[$key] = {input_hash: $input_hash, output_hash: $output_hash}' \
    "$INDEX_WORK_FILE" > "$temp_index_file"; then
    rm -f "$temp_index_file"
    _error "Failed to update index entry for: $source_relative_path"
    return 1
  fi

  mv "$temp_index_file" "$INDEX_WORK_FILE" || {
    rm -f "$temp_index_file"
    _error "Failed to store updated index entry for: $source_relative_path"
    return 1
  }

  return 0
}

_delete_index_entry() {
  local source_relative_path="$1"
  local temp_index_file

  temp_index_file=$(mktemp "${TEMP_DIR}/index-delete.XXXXXX") || {
    _error "Failed to create a temporary index file."
    return 1
  }

  if ! jq --arg key "$source_relative_path" 'del(.[$key])' "$INDEX_WORK_FILE" > "$temp_index_file"; then
    rm -f "$temp_index_file"
    _error "Failed to remove stale index entry for: $source_relative_path"
    return 1
  fi

  mv "$temp_index_file" "$INDEX_WORK_FILE" || {
    rm -f "$temp_index_file"
    _error "Failed to store updated index after deleting: $source_relative_path"
    return 1
  }

  return 0
}

_publish_index_snapshot() {
  local final_temp_index="$EFFECTIVE_OUTPUT/${INDEX_FILENAME}.tmp.$$.$RANDOM"

  if ! cp "$INDEX_WORK_FILE" "$final_temp_index"; then
    _error "Failed to write temporary index file: $final_temp_index"
    return 1
  fi

  PUBLISH_ATTEMPT_COUNT=$((PUBLISH_ATTEMPT_COUNT + 1))
  if [[ -n "${FMPE_TEST_FAIL_PUBLISH_ON_CALL:-}" && "$FMPE_TEST_FAIL_PUBLISH_ON_CALL" == "$PUBLISH_ATTEMPT_COUNT" ]]; then
    rm -f "$final_temp_index"
    _error "Simulated index publish failure on call $PUBLISH_ATTEMPT_COUNT"
    return 1
  fi

  if ! mv "$final_temp_index" "$INDEX_FILE"; then
    rm -f "$final_temp_index"
    _error "Failed to store index file: $INDEX_FILE"
    return 1
  fi

  return 0
}

_render_markdown_to_pdf() {
  local source_path="$1"
  local output_path="$2"
  local output_dir
  local output_name
  local temp_output_path
  local render_log
  local render_status
  local render_snippet

  output_dir=$(dirname "$output_path")
  output_name=$(basename "$output_path")

  mkdir -p "$output_dir" || {
    LAST_FAILURE_MESSAGE="failed to create output directory: $output_dir"
    return 1
  }

  temp_output_path="$output_dir/.${output_name}.tmp.$$.$RANDOM.pdf"
  render_log="$TEMP_DIR/pandoc-render.log"
  rm -f "$temp_output_path" "$render_log"

  pandoc "$source_path" --quiet --standalone --css "$DEFAULT_CSS_FILE" --pdf-engine weasyprint -o "$temp_output_path" >/dev/null 2>"$render_log"
  render_status=$?

  if [[ $render_status -ne 0 ]]; then
    render_snippet=$(_read_log_snippet "$render_log")
    if [[ -n "$render_snippet" ]]; then
      LAST_FAILURE_MESSAGE="pandoc exited $render_status: $render_snippet"
    else
      LAST_FAILURE_MESSAGE="pandoc exited $render_status"
    fi
    rm -f "$temp_output_path" "$render_log"
    return 1
  fi

  rm -f "$render_log"

  mv "$temp_output_path" "$output_path" || {
    rm -f "$temp_output_path"
    LAST_FAILURE_MESSAGE="failed to move rendered PDF into place: $output_path"
    return 1
  }

  return 0
}

_copy_non_markdown_file() {
  local source_path="$1"
  local output_path="$2"
  local output_dir
  local output_name
  local temp_output_path
  local copy_log
  local copy_status
  local copy_snippet

  output_dir=$(dirname "$output_path")
  output_name=$(basename "$output_path")

  mkdir -p "$output_dir" || {
    LAST_FAILURE_MESSAGE="failed to create output directory: $output_dir"
    return 1
  }

  temp_output_path="$output_dir/.${output_name}.tmp.$$.$RANDOM"
  copy_log="$TEMP_DIR/copy.log"
  rm -f "$temp_output_path" "$copy_log"

  cp "$source_path" "$temp_output_path" 2>"$copy_log"
  copy_status=$?

  if [[ $copy_status -ne 0 ]]; then
    copy_snippet=$(_read_log_snippet "$copy_log")
    if [[ -n "$copy_snippet" ]]; then
      LAST_FAILURE_MESSAGE="copy exited $copy_status: $copy_snippet"
    else
      LAST_FAILURE_MESSAGE="copy exited $copy_status"
    fi
    rm -f "$temp_output_path" "$copy_log"
    return 1
  fi

  rm -f "$copy_log"

  mv "$temp_output_path" "$output_path" || {
    rm -f "$temp_output_path"
    LAST_FAILURE_MESSAGE="failed to move copied file into place: $output_path"
    return 1
  }

  return 0
}

_process_file() {
  local source_path="$1"
  local source_relative_path
  local output_relative_path
  local output_path
  local input_hash
  local stored_input_hash
  local stored_output_hash
  local current_output_hash=""
  local output_hash
  local action_label
  local output_backup_path=""
  local output_backup_state=""
  local index_backup_path=""

  source_relative_path=$(_relative_path_from_root "$source_path" "$EFFECTIVE_INPUT") || return 1
  output_relative_path=$(_relative_output_path_for_source "$source_relative_path")
  output_path="$EFFECTIVE_OUTPUT/$output_relative_path"
  LAST_FAILURE_MESSAGE=""

  if ! input_hash=$(_hash_file "$source_path"); then
    _record_failed_file "$source_relative_path" "failed to hash input file" || return 1
    return 10
  fi

  stored_input_hash=$(_get_index_input_hash "$source_relative_path") || return 1
  stored_output_hash=$(_get_index_output_hash "$source_relative_path") || return 1

  if [[ -f "$output_path" ]]; then
    if ! current_output_hash=$(_hash_file "$output_path"); then
      _record_failed_file "$source_relative_path" "failed to hash existing output file" || return 1
      return 10
    fi
  fi

  if [[ -n "$stored_input_hash" && "$stored_input_hash" == "$input_hash" && -n "$stored_output_hash" && -n "$current_output_hash" && "$stored_output_hash" == "$current_output_hash" ]]; then
    _record_live_output_path "$output_relative_path" || return 1
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    _log_status "SKIP" "$source_relative_path" "up to date"
    return 0
  fi

  _prepare_output_rollback "$output_path" output_backup_path output_backup_state || return 1

  case "$source_relative_path" in
    *.md)
      action_label="CONVERT"
      if ! _render_markdown_to_pdf "$source_path" "$output_path"; then
        _record_failed_file "$source_relative_path" "$LAST_FAILURE_MESSAGE" || return 1
        if _source_has_preserved_output_state "$source_relative_path" "$output_path"; then
          _record_live_output_path "$output_relative_path" || return 1
        fi
        return 10
      fi
      ;;
    *)
      action_label="COPY"
      if ! _copy_non_markdown_file "$source_path" "$output_path"; then
        _record_failed_file "$source_relative_path" "$LAST_FAILURE_MESSAGE" || return 1
        if _source_has_preserved_output_state "$source_relative_path" "$output_path"; then
          _record_live_output_path "$output_relative_path" || return 1
        fi
        return 10
      fi
      ;;
  esac

  _prepare_index_work_rollback index_backup_path || {
    _rollback_output_and_index_change "$output_path" "$output_backup_path" "$output_backup_state" "" || return 1
    return 1
  }

  if ! output_hash=$(_hash_file "$output_path"); then
    _rollback_output_and_index_change "$output_path" "$output_backup_path" "$output_backup_state" "$index_backup_path" || return 1
    _error "Output was updated but failed to hash committed output: $output_path"
    return 1
  fi

  if ! _upsert_index_entry "$source_relative_path" "$input_hash" "$output_hash"; then
    _rollback_output_and_index_change "$output_path" "$output_backup_path" "$output_backup_state" "$index_backup_path" || return 1
    return 1
  fi

  if ! _publish_index_snapshot; then
    _rollback_output_and_index_change "$output_path" "$output_backup_path" "$output_backup_state" "$index_backup_path" || return 1
    return 1
  fi

  _record_live_output_path "$output_relative_path" || return 1

  if [[ "$action_label" == "CONVERT" ]]; then
    CONVERTED_COUNT=$((CONVERTED_COUNT + 1))
  else
    COPIED_COUNT=$((COPIED_COUNT + 1))
  fi

  _log_status "$action_label" "$source_relative_path"
  return 0
}

_process_input_files() {
  local source_path
  local source_relative_path
  local output_relative_path
  local process_status

  while IFS= read -r -d '' source_path; do
    source_relative_path=$(_relative_path_from_root "$source_path" "$EFFECTIVE_INPUT") || return 1
    output_relative_path=$(_relative_output_path_for_source "$source_relative_path")

    if _source_is_collision_skipped "$source_relative_path"; then
      if _source_has_preserved_output_state "$source_relative_path" "$EFFECTIVE_OUTPUT/$output_relative_path"; then
        _record_live_output_path "$output_relative_path" || return 1
      fi

      COLLISION_SKIPPED_COUNT=$((COLLISION_SKIPPED_COUNT + 1))
      continue
    fi

    _process_file "$source_path"
    process_status=$?

    case "$process_status" in
      0)
        ;;
      10)
        ;;
      *)
        return 1
        ;;
    esac
  done < "$INPUT_FIND_RESULTS"

  return 0
}

_remove_stale_index_entries_for_output_path() {
  local output_relative_path="$1"
  local index_keys_file="$TEMP_DIR/index-keys-for-output.txt"
  local source_relative_path
  local entry_output_relative_path

  if ! jq -r 'keys[]?' "$INDEX_WORK_FILE" > "$index_keys_file"; then
    _error "Failed to enumerate index entries during cleanup."
    return 1
  fi

  while IFS= read -r source_relative_path; do
    if [[ -z "$source_relative_path" ]]; then
      continue
    fi

    if grep -Fx -- "$source_relative_path" "$SOURCE_MANIFEST" >/dev/null 2>&1; then
      continue
    fi

    entry_output_relative_path=$(_relative_output_path_for_source "$source_relative_path")
    if [[ "$entry_output_relative_path" != "$output_relative_path" ]]; then
      continue
    fi

    _delete_index_entry "$source_relative_path" || return 1
  done < "$index_keys_file"

  return 0
}

_cleanup_orphan_outputs() {
  local output_path
  local output_relative_path
  local source_relative_path
  local index_keys_file="$TEMP_DIR/stale-index-keys.txt"
  local output_backup_path=""
  local output_backup_state=""
  local index_backup_path=""

  if ! find "$EFFECTIVE_OUTPUT" -type f ! -name "$INDEX_FILENAME" -print0 > "$OUTPUT_FIND_RESULTS"; then
    _error "Failed to traverse output directory during cleanup: $EFFECTIVE_OUTPUT"
    return 1
  fi

  while IFS= read -r -d '' output_path; do
    output_relative_path=$(_relative_path_from_root "$output_path" "$EFFECTIVE_OUTPUT") || return 1

    if grep -Fx -- "$output_relative_path" "$OUTPUT_MANIFEST" >/dev/null 2>&1; then
      continue
    fi

    _prepare_output_rollback "$output_path" output_backup_path output_backup_state || return 1
    _prepare_index_work_rollback index_backup_path || return 1

    rm -f "$output_path" || {
      _restore_index_work_rollback "$index_backup_path" || return 1
      _error "Failed to delete orphaned output file: $output_path"
      return 1
    }

    if ! _remove_stale_index_entries_for_output_path "$output_relative_path"; then
      _rollback_output_and_index_change "$output_path" "$output_backup_path" "$output_backup_state" "$index_backup_path" || return 1
      return 1
    fi

    if ! _publish_index_snapshot; then
      _rollback_output_and_index_change "$output_path" "$output_backup_path" "$output_backup_state" "$index_backup_path" || return 1
      return 1
    fi

    ORPHANED_COUNT=$((ORPHANED_COUNT + 1))
    _log_status "ORPHAN" "$output_relative_path"
  done < "$OUTPUT_FIND_RESULTS"

  if ! jq -r 'keys[]?' "$INDEX_WORK_FILE" > "$index_keys_file"; then
    _error "Failed to enumerate index entries during cleanup."
    return 1
  fi

  while IFS= read -r source_relative_path; do
    if [[ -z "$source_relative_path" ]]; then
      continue
    fi

    if grep -Fx -- "$source_relative_path" "$SOURCE_MANIFEST" >/dev/null 2>&1; then
      continue
    fi

    _prepare_index_work_rollback index_backup_path || return 1

    if ! _delete_index_entry "$source_relative_path"; then
      _restore_index_work_rollback "$index_backup_path" || return 1
      return 1
    fi

    if ! _publish_index_snapshot; then
      _restore_index_work_rollback "$index_backup_path" || return 1
      return 1
    fi
  done < "$index_keys_file"

  return 0
}

_remove_empty_output_dirs() {
  find "$EFFECTIVE_OUTPUT" -depth -type d -empty ! -path "$EFFECTIVE_OUTPUT" -exec rmdir {} \; 2>/dev/null
  return 0
}

main() {
  local parse_status
  local run_status=0

  _parse_arguments "$@"
  parse_status=$?

  if [[ $parse_status -eq 2 ]]; then
    return 0
  fi

  if [[ $parse_status -ne 0 ]]; then
    return 1
  fi

  _check_dependencies || return 1
  _resolve_effective_input || return 1
  _resolve_effective_output || return 1
  _setup_temp_dir || return 1
  _resolve_ignore_manifests || return 1
  _write_default_css || return 1
  _initialize_output_state || return 1

  if ! _collect_input_manifests; then
    _print_summary
    return 1
  fi

  _process_input_files || run_status=1

  if [[ $run_status -eq 0 ]]; then
    _cleanup_orphan_outputs || run_status=1
  fi

  if [[ $run_status -eq 0 ]]; then
    _remove_empty_output_dirs || run_status=1
  fi

  if [[ $run_status -eq 0 && $FAILED_COUNT -eq 0 && $COLLISION_SKIPPED_COUNT -eq 0 && ! -f "$INDEX_FILE" ]]; then
    _publish_index_snapshot || run_status=1
  fi

  _print_summary

  if [[ $run_status -ne 0 ]]; then
    return 1
  fi

  if [[ $FAILED_COUNT -gt 0 || $COLLISION_SKIPPED_COUNT -gt 0 ]]; then
    return 1
  fi

  return 0
}

main "$@"
}
