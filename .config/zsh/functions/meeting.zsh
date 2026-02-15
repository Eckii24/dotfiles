# ==============================================================================
#  🎙️  MEETING ASSISTANT (Zscaler Safe & M4 optimized)
# ==============================================================================

function meeting() {
    local cmd="$1"
    shift 
    case "$cmd" in
        install)    _meeting_install "$@" ;;
        start)      _meeting_start "$@" ;;
        record)     _meeting_record "$@" ;;
        transcribe) _meeting_transcribe "$@" ;;
        devices)    _meeting_list_devices ;;
        help|*)
            echo "Usage: meeting <command> [options]"
            echo ""
            echo "Commands:"
            echo "  install                          : Check dependencies & model"
            echo "  start                            : Record & Transcribe"
            echo "  record                           : Record only"
            echo "  transcribe <file>                : Transcribe file"
            echo "  devices                          : List audio inputs"
            echo ""
            echo "Run 'meeting <command> --help' for command-specific options"
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
                echo "Usage: meeting install [options]"
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
    local mic=""
    local mic_name="MeetingCombined"
    local interactive=false
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: meeting start [options]"
                echo ""
                echo "Record and transcribe a meeting"
                echo ""
                echo "Options:"
                echo "  -m, --model <name>               : Model name (default: $model_name)"
                echo "  --model-dir <path>               : Model directory (default: $model_dir)"
                echo "  --output-dir <path>              : Output directory (default: $output_dir)"
                echo "  -c, --clipboard                  : Copy transcript to clipboard"
                echo "  --mic <id>                       : Microphone ID (takes priority over --mic-name)"
                echo "  --mic-name <name>                : Microphone name (default: $mic_name)"
                echo "  -i, --interactive                : Interactive mode - list devices and select mic"
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
            --mic)
                mic="$2"
                shift 2
                ;;
            --mic-name)
                mic_name="$2"
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
    
    local date_dir="$output_dir/$(date +%Y-%m-%d)"
    local target="$date_dir/meeting_$(date +%H-%M-%S).mkv"

    _meeting_record --output-dir "$output_dir" --mic "$mic" --mic-name "$mic_name" $([ "$interactive" = true ] && echo "-i") || return 1

    [ -f "$target" ] && _meeting_transcribe "$target" -m "$model_name" --model-dir "$model_dir" $([ "$clipboard" = true ] && echo "-c")
}

function _meeting_record() {
    local output_dir="$HOME/Meetings"
    local mic_id=""
    local mic_name="MeetingCombined"
    local interactive=false
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: meeting record [options]"
                echo ""
                echo "Record audio from a specified device"
                echo ""
                echo "Options:"
                echo "  --output-dir <path>              : Output directory (default: $output_dir)"
                echo "                                     Subdirectory YYYY-MM-DD and filename will be created automatically"
                echo "  --mic <id>                       : Microphone ID (takes priority over --mic-name)"
                echo "  --mic-name <name>                : Microphone name (default: $mic_name)"
                echo "  -i, --interactive                : Interactive mode - list devices and select mic"
                return 0
                ;;
            --output-dir)
                output_dir="$2"
                shift 2
                ;;
            --mic)
                mic_id="$2"
                shift 2
                ;;
            --mic-name)
                mic_name="$2"
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
    
    local date_dir="$output_dir/$(date +%Y-%m-%d)"
    local output_file="$date_dir/meeting_$(date +%H-%M-%S).mkv"
    local mic_id=""
    
    if [ "$interactive" = true ]; then
        _meeting_list_devices
        echo "Enter microphone ID: "
        read mic_id
    elif [ -n "$mic_name" ]; then
        mic_id=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep "$mic_name" | sed -E 's/.*\[([0-9]+)\].*/\1/' | head -1)
    fi
    
    if [ -z "$mic_id" ]; then
        echo "❌ Microphone not found (ID or name: ${mic_id:-$mic_name})"
        return 1
    fi
    
    mkdir -p "$date_dir"

    echo "🔴 Recording from device ID $mic_id..."
    echo "   Quality: 48kHz -> 16kHz Mono Downmix"
    
    ffmpeg -f avfoundation -probesize 10M -analyzeduration 10M -i ":$mic_id" \
           -filter_complex "[0:a]pan=1c|c0=0.5*c0+0.5*c1[out]" \
           -map "[out]" \
           -c:a pcm_s16le -ar 16000 -f matroska -y "$output_file"
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
                echo "Usage: meeting transcribe <file> [options]"
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
