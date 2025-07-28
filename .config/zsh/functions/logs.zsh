#!/bin/bash

logs() {
    local filters=()
    local new_line_identifiers=()
    local input_file=""
    local input_source=""
    local output_file=""
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--filter)
                filters+=("$2")
                shift 2
                ;;
            -N|--new-line-identifier)
                new_line_identifiers+=("$2")
                shift 2
                ;;
            -i|--input)
                input_file="$2"
                shift 2
                ;;
            -o|--out)
                output_file="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1" >&2
                return 1
                ;;
        esac
    done
    
    # Determine input source
    if [[ -n "$input_file" ]]; then
        input_source="$input_file"
    elif [[ ! -t 0 ]]; then
        # stdin is available (piped input)
        input_source="/dev/stdin"
    else
        echo "Error: No input provided. Use -i/--input or pipe data to the function." >&2
        return 1
    fi

    # Redirect output if output_file is set
    if [[ -n "$output_file" ]]; then
        exec 3>&1           # Save current stdout
        exec 1>"$output_file"
    fi

    # Function to check if a line matches any pattern in an array (with wildcard support)
    matches_pattern() {
        local line="$1"
        local patterns=("${@:2}")
        
        for pattern in "${patterns[@]}"; do
            # Convert shell wildcard pattern to match
            if [[ "$line" == *$pattern* ]]; then
                return 0
            fi
        done
        return 1
    }
    
    local capturing=false
    
    # Process input line by line
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$capturing" == false ]]; then
            # Not currently capturing, check if line matches any filter
            if [[ ${#filters[@]} -eq 0 ]] || matches_pattern "$line" "${filters[@]}"; then
                capturing=true
                echo $line
            fi
        else
            # Currently capturing
            # Check if line matches any new-line-identifier
            if [[ ${#new_line_identifiers[@]} -gt 0 ]] && matches_pattern "$line" "${new_line_identifiers[@]}"; then
                capturing=false
                # Don't add the new-line-identifier line to result
                continue
            else
                # Add line to result
                echo $line
            fi
        fi
    done < "$input_source"

    # Restore stdout if it was redirected
    if [[ -n "$output_file" ]]; then
        exec 1>&3
        exec 3>&-
    fi
}
