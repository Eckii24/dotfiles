# ==============================================================================
#  🎙️  MEETING ASSISTANT (Zscaler Safe & M4 optimized)
# ==============================================================================

export MEETING_ROOT="$HOME/.meeting-assistant"
export MEETING_MODELS_DIR="$MEETING_ROOT/models"
export MEETING_MODEL_NAME="medium" 

function meeting() {
    local cmd="$1"
    shift 
    case "$cmd" in
        install)    _meeting_install ;;
        start)      _meeting_start "$@" ;;
        record)     _meeting_record "$@" ;;
        transcribe) _meeting_transcribe "$@" ;;
        devices)    _meeting_list_devices ;;
        help|*)
            echo "Usage: meeting <command>"
            echo "  install            : Check dependencies & model"
            echo "  start [mic_id]     : Record & Transcribe"
            echo "  record [mic_id]    : Record only"
            echo "  transcribe <file>  : Transcribe file"
            echo "  devices            : List inputs"
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
    mkdir -p "$MEETING_MODELS_DIR"
    echo "📦 Checking environment..."
    brew install ffmpeg blackhole-2ch whisper-cpp

    local model_path="$MEETING_MODELS_DIR/ggml-${MEETING_MODEL_NAME}.bin"
    local download_url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MEETING_MODEL_NAME}.bin"
    
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
        echo "mv ~/Downloads/ggml-${MEETING_MODEL_NAME}.bin $model_path"
        return 1
    fi
    echo "✅ Model exists and seems valid."
}

function _meeting_start() {
    _meeting_check_deps || return 1
    local mic_id="$1"
    local date_dir="$HOME/Meetings/$(date +%Y-%m-%d)"
    mkdir -p "$date_dir"
    local target="$date_dir/meeting_$(date +%H-%M-%S).mkv"

    _meeting_record "$mic_id" "$target"
    [ -f "$target" ] && _meeting_transcribe "$target"
}

function _meeting_record() {
    local mic_id="$1" # Wird jetzt ignoriert, wenn wir das Combined Device nutzen
    local output_file="${2:-$HOME/Meetings/$(date +%Y-%m-%d)/meeting_$(date +%H-%M-%S).mkv}"
    mkdir -p "$(dirname "$output_file")"

    # Wir suchen direkt nach unserem neuen Hauptgerät
    local combined_id=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep "MeetingCombined" | sed -E 's/.*\[([0-9]+)\].*/\1/' | head -1)
    
    if [ -z "$combined_id" ]; then
        echo "❌ 'MeetingCombined' Device not found! Please create it in Audio-MIDI-Setup."
        return 1
    fi

    echo "🔴 Recording from MeetingCombined (ID: $combined_id)..."
    echo "   Quality: 48kHz -> 16kHz Mono Downmix"
    
    # -probesize und -analyzeduration helfen gegen Sync-Probleme
    # Wir nehmen Kanal 0 (dein Mic) und Kanal 1 (Teams) und mischen sie sauber
    ffmpeg -f avfoundation -probesize 10M -analyzeduration 10M -i ":$combined_id" \
           -filter_complex "[0:a]pan=1c|c0=0.5*c0+0.5*c1[out]" \
           -map "[out]" \
           -c:a pcm_s16le -ar 16000 -f matroska -y "$output_file"
}

function _meeting_transcribe() {
    _meeting_check_deps || return 1
    local input="$1"
    [ ! -f "$input" ] && { echo "❌ File not found"; return 1; }

    local base="${input%.*}"
    local wav_temp="${base}_temp.wav"
    local model="$MEETING_MODELS_DIR/ggml-${MEETING_MODEL_NAME}.bin"

    echo "🔄 Converting..."
    ffmpeg -i "$input" -ar 16000 -ac 1 -c:a pcm_s16le -y "$wav_temp" -hide_banner -loglevel error

    echo "🧠 Whisper Inferenz (M4 Max Metal)..."
    # Wir nutzen -otxt, beachten aber dass whisper-cli ".txt" an den Input-Namen hängt
    whisper-cli -m "$model" -f "$wav_temp" -l de -otxt > /dev/null

    # Die Datei heißt nun temp.wav.txt -> wir benennen sie sauber um
    if [ -f "${wav_temp}.txt" ]; then
        mv "${wav_temp}.txt" "${base}.txt"
        rm "$wav_temp"
        echo "✅ Success: ${base}.txt"
        # open "$(dirname "$input")"
    else
        echo "❌ Transcription failed (Output file not found)."
        return 1
    fi
}
