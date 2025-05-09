function update-music() {
    # Ensure the function uses Zsh features, especially if sourced in a compatibility mode.
    emulate -L zsh
    # For advanced globbing features if needed, though not strictly necessary for this script.
    # setopt extendedglob

    # Local variables for storing parsed arguments and other data.
    local album_name
    local music_dir
    # Associative array to hold parsed options from zparseopts.
    local -A options_map

    # --- Helper function for displaying usage instructions ---
    _usage() {
        # FUNCNAME[1] refers to the name of the calling function (tag_music_files).
        echo "Usage: ${FUNCNAME[1]} --album \"Album Title\" --path \"/path/to/music\"" >&2
        echo "       ${FUNCNAME[1]} -a \"Album Title\" -p \"/path/to/music\"" >&2
        echo "" >&2
        echo "Options:" >&2
        echo "  -a, --album <name>    Required. Set the album name for all tracks." >&2
        echo "  -p, --path <dir>      Required. Specify the directory containing music files." >&2
        echo "  --help                Show this help message and exit." >&2
    }

    # --- Handle --help argument ---
    # Check if --help is present anywhere in the arguments.
    # The spaces around " $@ " and " --help " ensure it matches the whole argument.
    if [[ " $@ " == *" --help "* ]]; then
        _usage
        return 0
    fi

    # --- Parse command-line options ---
    # zparseopts populates 'options_map' based on the provided specifications.
    # -E: If an error occurs during parsing (e.g., unknown option), zparseopts prints
    #     a message to stderr and returns a non-zero status.
    # -A options_map: Stores parsed options and their arguments into the 'options_map'
    #                 associative array.
    # '--': Marks the end of options; anything after this is a positional argument (none expected here).
    # '-a:', '-album:', '-p:', '-path:': Define options that take an argument.
    #     e.g., for '-a "My Album"', options_map[-a] will be "My Album".
    if ! zparseopts -E -A options_map -- -a: -album: -p: -path: ; then
        # If zparseopts returns an error (e.g., unknown option), print usage and exit.
        # zparseopts itself will have already printed an error message.
        _usage
        return 1
    fi

    # --- Retrieve and validate album name ---
    if [[ -n "${options_map[-a]}" ]]; then # Check if -a was used
        album_name="${options_map[-a]}"
    elif [[ -n "${options_map[--album]}" ]]; then # Check if --album was used
        album_name="${options_map[--album]}"
    else
        echo "Error: Album name not specified." >&2
        _usage
        return 1
    fi

    # --- Retrieve and validate music directory path ---
    if [[ -n "${options_map[-p]}" ]]; then # Check if -p was used
        music_dir="${options_map[-p]}"
    elif [[ -n "${options_map[--path]}" ]]; then # Check if --path was used
        music_dir="${options_map[--path]}"
    else
        echo "Error: Music directory path not specified." >&2
        _usage
        return 1
    fi

    # --- Expand tilde (~) in music_dir if present ---
    # Example: if music_dir is "~/Music", ${(e)music_dir} expands it to "/home/user/Music".
    music_dir=${(e)music_dir}

    # --- Validate that music_dir is an actual directory ---
    if [[ ! -d "$music_dir" ]]; then
        echo "Error: Path '$music_dir' is not a directory or does not exist." >&2
        return 1
    fi

    # --- Check if eyeD3 command is available ---
    if ! command -v eyeD3 &> /dev/null; then
        echo "Error: eyeD3 command not found. Please install it first." >&2
        echo "You can typically install it using your system's package manager:" >&2
        echo "  e.g., 'sudo apt install eyed3' (for Debian/Ubuntu based systems)" >&2
        echo "  e.g., 'brew install eyed3' (for macOS with Homebrew)" >&2
        return 1
    fi

    echo "Album to set: \"$album_name\""
    echo "Processing files in directory: \"$music_dir\""

    # --- Find music files in the specified directory ---
    # Create an array 'files_to_process' containing paths to the files.
    # Glob qualifiers are used for precise matching:
    #   "$music_dir"/* : Matches all items in the music_dir.
    #   (N) : Nullglob - if no files match, the array will be empty (no error).
    #   (.) : Regular files only - excludes directories, symlinks, etc.
    #   (od): Order by name (ascending, default Zsh sort which is usually lexical).
    #         Use (On) for case-insensitive name sort if preferred.
    local files_to_process
    files_to_process=("$music_dir"/*(N.od))

    # --- Check if any files were found ---
    if (( ${#files_to_process[@]} == 0 )); then
        echo "No files found in '$music_dir'. Nothing to do."
        return 0 # Successful exit, as no files to process isn't an error.
    fi

    local total_files=${#files_to_process[@]}
    local current_index=1

    echo "Found $total_files file(s) to process."

    # --- Loop through each file and apply eyeD3 ---
    for file_path in "${files_to_process[@]}"; do
        # Ensure file_path is quoted to correctly handle filenames with spaces or special characters.
        echo "Processing ($current_index/$total_files): \"$file_path\""

        # The eyeD3 command as specified in the request:
        # eyeD3 --album "$album" --to-v2.4 "$file" -n $index -N $total
        if eyeD3 --album "$album_name" --to-v2.4 "$file_path" -n "$current_index" -N "$total_files"; then
            echo "Successfully tagged: \"$file_path\""
        else
            # If eyeD3 fails for a file, print an error message.
            # $? holds the exit status of the last executed command (eyeD3 in this case).
            echo "Error tagging \"$file_path\". eyeD3 exited with status $?. Check eyeD3 output for details." >&2
            # By default, the script will continue with the next file.
            # To make the script stop on the first error, uncomment the following line:
            # return 1
        fi
        current_index=$((current_index + 1))
    done

    echo "Finished processing all files in '$music_dir'."
    return 0
}

