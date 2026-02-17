# ==============================================================================
#  🎙️  AUDIO ASSISTANT (Zscaler Safe & M4 optimized)
# ==============================================================================

function audio() {
    local cmd="$1"
    shift 
    case "$cmd" in
        install)    _meeting_install "$@" ;;
        start)      _meeting_start "$@" ;;
        record)     _meeting_record "$@" ;;
        transcribe) _meeting_transcribe "$@" ;;
        devices)    _meeting_list_devices ;;
        help|*)
            echo "Usage: audio <command> [options]"
            echo ""
            echo "Commands:"
            echo "  install                          : Check dependencies & model"
            echo "  start                            : Record & Transcribe"
            echo "  record                           : Record only"
            echo "  transcribe <file>                : Transcribe file"
            echo "  devices                          : List audio inputs"
            echo ""
            echo "Run 'audio <command> --help' for command-specific options"
            ;;
    esac
}

function _meeting_check_deps() {
    command -v ffmpeg >/dev/null || { echo "❌ ffmpeg missing."; return 1; }
    command -v whisper-cli >/dev/null || { echo "❌ whisper-cli missing. Run 'brew install whisper-cpp'."; return 1; }
}

function _meeting_list_devices() {
    ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep "AVFoundation audio devices:" -A 20
}

function _meeting_install() {
    local model_name="medium"
    local model_dir="$HOME/.meeting-assistant/models"
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audio install [options]"
                echo ""
                echo "Options:"
                echo "  -m, --model <name>               : Model name (default: $model_name)"
                echo "  --model-dir <path>               : Model directory (default: $model_dir)"
                return 0
                ;;
            -m|--model)
                model_name="$2"
                shift 2
                ;;
            --model-dir)
                model_dir="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
    
    mkdir -p "$model_dir"
    echo "📦 Checking environment..."
    brew install ffmpeg blackhole-2ch whisper-cpp

    local model_path="$model_dir/ggml-${model_name}.bin"
    local download_url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model_name}.bin"
    
    if [ -f "$model_path" ]; then
        local filesize=$(stat -f%z "$model_path")
        if [ "$filesize" -lt 100000000 ]; then
            echo -e "\033[0;31m⚠️  Model file is too small ($filesize bytes). Zscaler likely blocked it.\033[0m"
            rm "$model_path"
        fi
    fi

    if [ ! -f "$model_path" ]; then
        echo -e "\033[1;33m📥 MANUAL ACTION REQUIRED (Zscaler Bypass):\033[0m"
        echo "1. Open this link in your Browser: $download_url"
        echo "2. Download the file manually."
        echo "3. Move it to: $model_path"
        echo ""
        echo "Command to move (after download):"
        echo "mv ~/Downloads/ggml-${model_name}.bin $model_path"
        return 1
    fi
    echo "✅ Model exists and seems valid."
}

function _meeting_start() {
    _meeting_check_deps || return 1
    
    local model_name="medium"
    local model_dir="$HOME/.meeting-assistant/models"
    local output_dir="$HOME/Meetings"
    local clipboard=false
    local device=""
    local device_name="Headphone IN"
    local interactive=false
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audio start [options]"
                echo ""
                echo "Record and transcribe audio"
                echo ""
                echo "Options:"
                echo "  -m, --model <name>               : Model name (default: $model_name)"
                echo "  --model-dir <path>               : Model directory (default: $model_dir)"
                echo "  --output-dir <path>              : Output directory (default: $output_dir)"
                echo "  -c, --clipboard                  : Copy transcript to clipboard"
                echo "  --device <id>                    : Audio device ID (priority over --device-name)"
                echo "  --device-name <name>             : Audio device name (default: $device_name)"
                echo "  -i, --interactive                : Interactive mode - list devices and select"
                return 0
                ;;
            -m|--model)
                model_name="$2"
                shift 2
                ;;
            --model-dir)
                model_dir="$2"
                shift 2
                ;;
            --output-dir)
                output_dir="$2"
                shift 2
                ;;
            -c|--clipboard)
                clipboard=true
                shift
                ;;
            --device)
                device="$2"
                shift 2
                ;;
            --device-name)
                device_name="$2"
                shift 2
                ;;
            -i|--interactive)
                interactive=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
    
    # Call recording and capture the output filename
    local recorded_file=$(_meeting_record --output-dir "$output_dir" --device "$device" --device-name "$device_name" $([ "$interactive" = true ] && echo "-i"))
    local record_result=$?
    
    # Only proceed with transcription if recording succeeded
    if [ $record_result -eq 0 ] && [ -n "$recorded_file" ] && [ -f "$recorded_file" ]; then
        _meeting_transcribe "$recorded_file" -m "$model_name" --model-dir "$model_dir" $([ "$clipboard" = true ] && echo "-c")
    elif [ $record_result -ne 0 ]; then
        echo "❌ Recording failed"
        return 1
    else
        echo "⚠️  Recording file not found: $recorded_file"
        return 1
    fi
}

function _meeting_record() {
    local output_dir="$HOME/Meetings"
    local device_id=""
    local device_name="Headphone IN"
    local interactive=false
    
    # --- 1. Argument Parsing ---
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audio record [options]"
                echo ""
                echo "Record audio from an aggregate device (BlackHole + Microphone)"
                echo ""
                echo "Options:"
                echo "  --output-dir <path>     : Output directory (default: $output_dir)"
                echo "  --device <id>           : Audio device ID (priority over --device-name)"
                echo "  --device-name <name>    : Audio device name (default: $device_name)"
                echo "  -i, --interactive       : Interactive mode - list and select device"
                echo ""
                echo "Setup: Create an Aggregate Device in Audio MIDI Setup that combines"
                echo "       BlackHole 2ch (as clock source) and your microphone (with drift correction)."
                return 0
                ;;
            --output-dir) output_dir="$2"; shift 2 ;;
            --device) device_id="$2"; shift 2 ;;
            --device-name) device_name="$2"; shift 2 ;;
            -i|--interactive) interactive=true; shift ;;
            *) shift ;;
        esac
    done

    # --- 2. Device Selection ---
    if [ "$interactive" = true ]; then
        _meeting_list_devices
        echo -n "Enter device ID: "
        read device_id
    elif [ -z "$device_id" ]; then
        device_id=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep "$device_name" | sed -E 's/.*\[([0-9]+)\].*/\1/' | head -1)
    fi
    
    if [ -z "$device_id" ]; then
        echo "❌ Device not found: ${device_name}"
        echo "   Run 'audio devices' to list available devices"
        return 1
    fi

    # --- 3. File Setup ---
    local date_dir="$output_dir/$(date +%Y-%m-%d)"
    local output_file="$date_dir/meeting_$(date +%H-%M-%S).mkv"
    mkdir -p "$date_dir"

    echo "🔴 Recording from device $device_id ($device_name)..."
    echo "   Output: $output_file"
    echo "   Press Ctrl+C to stop recording"
    
    # --- 4. Simple Recording ---
    # The aggregate device handles mixing and sample rate drift correction
    # We just record directly and convert to 16kHz mono for transcription
    ffmpeg -f avfoundation \
           -i ":$device_id" \
           -c:a pcm_s16le -ar 16000 -ac 1 \
           -f matroska -y "$output_file"
    
    local ffmpeg_result=$?
    
    if [ $ffmpeg_result -eq 0 ]; then
        echo "$output_file"
        return 0
    else
        return $ffmpeg_result
    fi
}

function _meeting_transcribe() {
    _meeting_check_deps || return 1
    
    local input="$1"
    local model_name="medium"
    local model_dir="$HOME/.meeting-assistant/models"
    local clipboard=false
    shift
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audio transcribe <file> [options]"
                echo ""
                echo "Transcribe an audio file using Whisper"
                echo ""
                echo "Options:"
                echo "  -m, --model <name>               : Model name (default: $model_name)"
                echo "  --model-dir <path>               : Model directory (default: $model_dir)"
                echo "  -c, --clipboard                  : Copy transcript to clipboard instead of saving to file"
                return 0
                ;;
            -m|--model)
                model_name="$2"
                shift 2
                ;;
            --model-dir)
                model_dir="$2"
                shift 2
                ;;
            -c|--clipboard)
                clipboard=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
    
    [ ! -f "$input" ] && { echo "❌ File not found"; return 1; }

    local base="${input%.*}"
    local wav_temp="${base}_temp.wav"
    local model="$model_dir/ggml-${model_name}.bin"

    echo "🔄 Converting..."
    ffmpeg -i "$input" -ar 16000 -ac 1 -c:a pcm_s16le -y "$wav_temp" -hide_banner -loglevel error

    echo "🧠 Whisper Inferenz (M4 Max Metal)..."
    whisper-cli -m "$model" -f "$wav_temp" -l de -otxt > /dev/null

    if [ -f "${wav_temp}.txt" ]; then
        local txt_file="${base}.txt"
        if [ "$clipboard" = true ]; then
            cat "${wav_temp}.txt" | pbcopy
            rm "${wav_temp}.txt" "$wav_temp"
            echo "✅ Transcript copied to clipboard"
        else
            mv "${wav_temp}.txt" "$txt_file"
            rm "$wav_temp"
            echo "✅ Success: ${txt_file}"
        fi
    else
        echo "❌ Transcription failed (Output file not found)."
        return 1
    fi
}
