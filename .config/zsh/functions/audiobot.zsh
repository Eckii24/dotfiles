# ==============================================================================
#  🎙️  AUDIOBOT (Zscaler Safe & M4 optimized)
# ==============================================================================

# ==============================================================================
#  CONFIGURATION - Centralized defaults with environment variable fallbacks
# ==============================================================================
readonly AUDIOBOT_MODEL="${AUDIOBOT_MODEL:-large-v3-turbo}"
readonly AUDIOBOT_MODEL_DIR="${AUDIOBOT_MODEL_DIR:-$HOME/.audiobot/models}"
readonly AUDIOBOT_OUTPUT_DIR="${AUDIOBOT_OUTPUT_DIR:-$HOME/Meetings}"
readonly AUDIOBOT_DEVICE_NAME="${AUDIOBOT_DEVICE_NAME:-Headphone IN}"

function audiobot() {
    local cmd="$1"
    shift 
    case "$cmd" in
        install)    _audiobot_install "$@" ;;
        start)      _audiobot_start "$@" ;;
        record)     _audiobot_record "$@" ;;
        transcribe) _audiobot_transcribe "$@" ;;
        devices)    _audiobot_list_devices ;;
        cleanup)    _audiobot_cleanup "$@" ;;
        help)       _audiobot_help ;;
        *)
            echo "Usage: audiobot <command> [options]"
            echo ""
            echo "Commands:"
            echo "  install                          : Check dependencies & model"
            echo "  start                            : Record & Transcribe"
            echo "  record                           : Record only"
            echo "  transcribe <file>                : Transcribe file"
            echo "  devices                          : List audio inputs"
            echo "  cleanup                          : Remove old recordings"
            echo "  help                             : Show detailed setup guide"
            echo ""
            echo "Run 'audiobot <command> --help' for command-specific options"
            echo ""
            echo "Environment Variables:"
            echo "  AUDIOBOT_MODEL        : Whisper model name (default: large-v3-turbo)"
            echo "  AUDIOBOT_MODEL_DIR    : Model directory (default: ~/.audiobot/models)"
            echo "  AUDIOBOT_OUTPUT_DIR   : Output directory (default: ~/Meetings)"
            echo "  AUDIOBOT_DEVICE_NAME  : Default audio device name (default: Headphone IN)"
            ;;
    esac
}

function _audiobot_help() {
    cat <<'EOF'
# ==============================================================================
#  🎙️  AUDIOBOT - Complete Setup & Usage Guide
# ==============================================================================

## OVERVIEW
AudioBot helps you record and transcribe audio (meetings, calls, lectures)
using local AI processing (Whisper) optimized for M4 Macs. All processing happens
on your machine - no cloud services required.

## WHAT YOU CAN DO
  • Record system audio + microphone simultaneously
  • Transcribe audio files to text using Whisper AI
  • Record and transcribe in one command
  • List and select audio input devices
  • Copy transcripts directly to clipboard
  • Clean up old recordings automatically

## COMMANDS
  audiobot install              : Install dependencies and download Whisper model
  audiobot start                : Record and transcribe in one go
  audiobot record               : Record audio only
  audiobot transcribe <file>    : Transcribe an existing audio file
  audiobot devices              : List all available audio input devices
  audiobot cleanup              : Remove old recordings and transcripts
  audiobot help                 : Show this help guide

## ENVIRONMENT VARIABLES
You can customize defaults using these environment variables:
  AUDIOBOT_MODEL        : Whisper model name (default: large-v3-turbo)
  AUDIOBOT_MODEL_DIR    : Model directory (default: ~/.audiobot/models)
  AUDIOBOT_OUTPUT_DIR   : Output directory (default: ~/Meetings)
  AUDIOBOT_DEVICE_NAME  : Default audio device name (default: Headphone IN)

Example:
  export AUDIOBOT_OUTPUT_DIR="$HOME/Documents/Recordings"
  export AUDIOBOT_DEVICE_NAME="Recording Device"

## SETUP INSTRUCTIONS

### Step 1: Install Dependencies
Run:
  audiobot install

This installs: ffmpeg, BlackHole 2ch, and whisper-cpp via Homebrew.
It will also download the Whisper model (may require manual download if behind Zscaler).

### Step 2: Configure Audio MIDI Setup (CRITICAL!)
To capture both system audio AND your microphone, you need an Aggregate Device:

1. Open "Audio MIDI Setup" (in /Applications/Utilities/ or via Spotlight)

2. Click the "+" button at bottom left → Select "Create Aggregate Device"

3. Name it something like "Recording Device" or "Headphone IN"

4. In the device list, CHECK these boxes (in this order):
   ☑ BlackHole 2ch          ← Check this FIRST (will be clock source)
   ☑ Your Microphone        ← Check this SECOND (e.g., "MacBook Pro Microphone")

5. IMPORTANT: For your Microphone entry:
   • Check "Drift Correction" checkbox
   • This syncs microphone with BlackHole's timing

6. Click the "Use" dropdown next to "BlackHole 2ch" and ensure it shows "Clock Source"

7. Close Audio MIDI Setup - your aggregate device is ready!

### Step 3: Set BlackHole as System Output
1. Go to System Settings → Sound → Output
2. Select "BlackHole 2ch" as output device
3. System audio will now route through BlackHole (you won't hear it unless monitoring)

### Step 4: Start Recording
Run:
  audiobot start --device-name "Recording Device"

Replace "Recording Device" with whatever you named your aggregate device.

Or use interactive mode to select from a list:
  audiobot start -i

## EXAMPLE WORKFLOWS

### Record and transcribe a meeting:
  audiobot start --device-name "Headphone IN"

### Record only (no transcription):
  audiobot record --device-name "Headphone IN"

### Transcribe an existing file:
  audiobot transcribe ~/Meetings/2024-01-15/recording_14-30-00.mkv

### Copy transcript to clipboard instead of file:
  audiobot transcribe ~/path/to/audio.mkv -c

### List available audio devices:
  audiobot devices

### Clean up old recordings (older than 30 days):
  audiobot cleanup --days 30 --dry-run

## TROUBLESHOOTING

• "Device not found" error:
  Run 'audiobot devices' to see exact device names, then use the correct name

• No system audio in recording:
  Ensure BlackHole 2ch is set as system output in System Settings → Sound

• Microphone not captured:
  Check that microphone is enabled in aggregate device and has drift correction on

• Zscaler blocks model download:
  Follow the manual download instructions shown by 'audiobot install'

• Audio quality issues:
  Ensure BlackHole is the clock source in your aggregate device

## FILES & LOCATIONS
  Models:        ~/.audiobot/models/
  Recordings:    ~/Meetings/YYYY-MM-DD/recording_HH-MM-SS.mkv
  Transcripts:   ~/Meetings/YYYY-MM-DD/recording_HH-MM-SS.vtt

## MORE INFO
Run any command with --help for detailed options:
  audiobot start --help
  audiobot record --help
  audiobot transcribe --help
  audiobot cleanup --help

EOF
}

function _audiobot_check_deps() {
    command -v ffmpeg >/dev/null || { echo "❌ ffmpeg missing."; return 1; }
    command -v whisper-cli >/dev/null || { echo "❌ whisper-cli missing. Run 'brew install whisper-cpp'."; return 1; }
}

function _audiobot_list_devices() {
    echo "📋 Available Audio Devices:" >&2
    echo "" >&2
    ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep "AVFoundation audio devices:" -A 20 | grep "^\[AVFoundation.*\] \[[0-9]" | sed 's/.*\[\([0-9]\)/  [\1/' >&2
    echo "" >&2
}

function _audiobot_install() {
    local model_name="$AUDIOBOT_MODEL"
    local model_dir="$AUDIOBOT_MODEL_DIR"
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audiobot install [options]"
                echo ""
                echo "Options:"
                echo "  -m, --model <name>               : Model name (default: $AUDIOBOT_MODEL)"
                echo "  --model-dir <path>               : Model directory (default: $AUDIOBOT_MODEL_DIR)"
                echo ""
                echo "Environment Variables:"
                echo "  AUDIOBOT_MODEL        : Override default model"
                echo "  AUDIOBOT_MODEL_DIR    : Override default model directory"
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

function _audiobot_start() {
    _audiobot_check_deps || return 1
    
    local model_name="$AUDIOBOT_MODEL"
    local model_dir="$AUDIOBOT_MODEL_DIR"
    local output_dir="$AUDIOBOT_OUTPUT_DIR"
    local clipboard=false
    local device=""
    local device_name="$AUDIOBOT_DEVICE_NAME"
    local interactive=false
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audiobot start [options]"
                echo ""
                echo "Record and transcribe audio"
                echo ""
                echo "Options:"
                echo "  -m, --model <name>               : Model name (default: $AUDIOBOT_MODEL)"
                echo "  --model-dir <path>               : Model directory (default: $AUDIOBOT_MODEL_DIR)"
                echo "  --output-dir <path>              : Output directory (default: $AUDIOBOT_OUTPUT_DIR)"
                echo "  -c, --clipboard                  : Also copy transcript to clipboard"
                echo "  --device <id>                    : Audio device ID (priority over --device-name)"
                echo "  --device-name <name>             : Audio device name (default: $AUDIOBOT_DEVICE_NAME)"
                echo "  -i, --interactive                : Interactive mode - list devices and select"
                echo ""
                echo "Environment Variables:"
                echo "  AUDIOBOT_MODEL        : Override default model"
                echo "  AUDIOBOT_MODEL_DIR    : Override default model directory"
                echo "  AUDIOBOT_OUTPUT_DIR   : Override default output directory"
                echo "  AUDIOBOT_DEVICE_NAME  : Override default device name"
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
    local record_args=("--output-dir" "$output_dir" "--device" "$device" "--device-name" "$device_name")
    if [ "$interactive" = true ]; then
        record_args+=("--interactive")
    fi
    local recorded_file=$(_audiobot_record "${record_args[@]}")
    local record_result=$?
    
    # Only proceed with transcription if recording succeeded
    if [ $record_result -eq 0 ] && [ -n "$recorded_file" ] && [ -f "$recorded_file" ]; then
        _audiobot_transcribe "$recorded_file" -m "$model_name" --model-dir "$model_dir" $([ "$clipboard" = true ] && echo "-c")
    elif [ $record_result -ne 0 ]; then
        echo "❌ Recording failed" >&2
        return 1
    else
        echo "⚠️  Recording file not found: $recorded_file" >&2
        return 1
    fi
}

function _audiobot_record() {
    local output_dir="$AUDIOBOT_OUTPUT_DIR"
    local device_id=""
    local device_name="$AUDIOBOT_DEVICE_NAME"
    local interactive=false
    
    # --- 1. Argument Parsing ---
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audiobot record [options]"
                echo ""
                echo "Record audio from an aggregate device (BlackHole + Microphone)"
                echo ""
                echo "Options:"
                echo "  --output-dir <path>     : Output directory (default: $AUDIOBOT_OUTPUT_DIR)"
                echo "  --device <id>           : Audio device ID (priority over --device-name)"
                echo "  --device-name <name>    : Audio device name (default: $AUDIOBOT_DEVICE_NAME)"
                echo "  -i, --interactive       : Interactive mode - list and select device"
                echo ""
                echo "Environment Variables:"
                echo "  AUDIOBOT_OUTPUT_DIR   : Override default output directory"
                echo "  AUDIOBOT_DEVICE_NAME  : Override default device name"
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
        _audiobot_list_devices
        echo -n "Enter device ID: " >&2
        if ! read device_id < /dev/tty 2>/dev/null; then
            echo "❌ Interactive mode failed. Ensure you're running in an interactive terminal." >&2
            return 1
        fi
    elif [ -z "$device_id" ]; then
        device_id=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep "$device_name" | sed -E 's/.*\[([0-9]+)\].*/\1/' | head -1)
    fi
    
    if [ -z "$device_id" ]; then
        echo "❌ Device not found: ${device_name}"
        echo "   Run 'audiobot devices' to list available devices"
        return 1
    fi

    # --- 3. File Setup ---
    local date_dir="$output_dir/$(date +%Y-%m-%d)"
    local output_file="$date_dir/recording_$(date +%H-%M-%S).mkv"
    mkdir -p "$date_dir"

    echo "🔴 Recording from device $device_id ($device_name)..." >&2
    echo "   Output: $output_file" >&2
    echo "   Press Ctrl+C to stop recording" >&2
    echo "   Tip: Make sure BlackHole 2ch is set as output in System Settings to hear your voice" >&2
    
    # --- 4. Recording with explicit channel mix ---
    # Aggregate devices can expose 3 channels (BlackHole L/R + mic on ch2).
    # Explicitly mix c0+c1+c2 to mono so the microphone channel is not dropped.
    ffmpeg -f avfoundation \
           -i ":$device_id" \
           -af "pan=mono|c0=0.3333*c0+0.3333*c1+0.3333*c2" -c:a pcm_s16le -ar 16000 -ac 1 \
           -f matroska -y "$output_file"
    
    local ffmpeg_result=$?
    
    # Only output filename if the file actually exists and has content
    if [ $ffmpeg_result -eq 0 ] && [ -f "$output_file" ] && [ -s "$output_file" ]; then
        echo "$output_file"
        return 0
    else
        # Clean up incomplete file if it exists
        [ -f "$output_file" ] && rm -f "$output_file"
        echo "⚠️  Recording was interrupted or failed" >&2
        return 1
    fi
}

function _audiobot_transcribe() {
    _audiobot_check_deps || return 1
    
    local input="$1"
    local model_name="$AUDIOBOT_MODEL"
    local model_dir="$AUDIOBOT_MODEL_DIR"
    local clipboard=false
    shift
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audiobot transcribe <file> [options]"
                echo ""
                echo "Transcribe an audio file using Whisper"
                echo ""
                echo "Options:"
                echo "  -m, --model <name>               : Model name (default: $AUDIOBOT_MODEL)"
                echo "  --model-dir <path>               : Model directory (default: $AUDIOBOT_MODEL_DIR)"
                echo "  -c, --clipboard                  : Also copy transcript to clipboard"
                echo ""
                echo "Environment Variables:"
                echo "  AUDIOBOT_MODEL        : Override default model"
                echo "  AUDIOBOT_MODEL_DIR    : Override default model directory"
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
    
    [ ! -f "$input" ] && { echo "❌ File not found" >&2; return 1; }

    local base="${input%.*}"
    local wav_temp="${base}_temp.wav"
    local model="$model_dir/ggml-${model_name}.bin"

    echo "🔄 Converting..." >&2
    ffmpeg -i "$input" -ar 16000 -ac 1 -af silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-30dB -c:a pcm_s16le -y "$wav_temp" -hide_banner -loglevel error

    echo "🧠 Whisper Inferenz (M4 Max Metal)..." >&2
    whisper-cli -m "$model" -f "$wav_temp" -l auto -pp -t 10 -et 2.4 --prompt "Use correct spellings: dapr, OMR, OCT, GSS, TST, P0, Wendelin, Raphael" -ovtt

    if [ -f "${wav_temp}.vtt" ]; then
        local txt_file="${base}.vtt"
        # Always save to file
        mv "${wav_temp}.vtt" "$txt_file"
        rm "$wav_temp"
        
        # Always output to stdout for piping
        cat "$txt_file"
        
        # Optionally copy to clipboard
        if [ "$clipboard" = true ]; then
            cat "$txt_file" | pbcopy
            echo "✅ Transcript saved and piped (also copied to clipboard)" >&2
        else
            echo "✅ Transcript saved and piped (${txt_file})" >&2
        fi
    else
        echo "❌ Transcription failed (Output file not found)." >&2
        return 1
    fi
}

function _audiobot_cleanup() {
    local days=30
    local audio_only=false
    local dry_run=false
    local output_dir="$AUDIOBOT_OUTPUT_DIR"
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: audiobot cleanup [options]"
                echo ""
                echo "Remove old recordings and transcripts"
                echo ""
                echo "Options:"
                echo "  -d, --days <n>         : Remove recordings older than n days (default: 30)"
                echo "  --audio-only           : Remove only audio files, keep transcripts"
                echo "  --dry-run              : Show what would be deleted without deleting"
                echo "  --output-dir <path>    : Output directory (default: $AUDIOBOT_OUTPUT_DIR)"
                echo ""
                echo "Environment Variables:"
                echo "  AUDIOBOT_OUTPUT_DIR   : Override default output directory"
                return 0
                ;;
            -d|--days)
                days="$2"
                shift 2
                ;;
            --audio-only)
                audio_only=true
                shift
                ;;
            --dry-run)
                dry_run=true
                shift
                ;;
            --output-dir)
                output_dir="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
    
    if [ ! -d "$output_dir" ]; then
        echo "❌ Directory not found: $output_dir" >&2
        return 1
    fi
    
    echo "🧹 Cleanup Configuration:" >&2
    echo "   Directory: $output_dir" >&2
    echo "   Remove files older than: $days days" >&2
    echo "   Mode: $([ "$audio_only" = true ] && echo "Audio files only" || echo "Audio and transcripts")" >&2
    echo "   Dry run: $([ "$dry_run" = true ] && echo "Yes (no files will be deleted)" || echo "No")" >&2
    echo "" >&2
    
    local audio_count=0
    local transcript_count=0
    local audio_size=0
    local transcript_size=0
    
    # Find and process audio files
    while IFS= read -r -d '' file; do
        ((audio_count++))
        local size=$(stat -f%z "$file" 2>/dev/null || echo 0)
        ((audio_size+=size))
        
        if [ "$dry_run" = true ]; then
            echo "Would delete: $file" >&2
        else
            rm -f "$file"
            echo "Deleted: $file" >&2
        fi
    done < <(find "$output_dir" -type f -name "*.mkv" -mtime +$days -print0 2>/dev/null)
    
    # Find and process transcript files (unless audio-only mode)
    if [ "$audio_only" = false ]; then
        while IFS= read -r -d '' file; do
            ((transcript_count++))
            local size=$(stat -f%z "$file" 2>/dev/null || echo 0)
            ((transcript_size+=size))
            
            if [ "$dry_run" = true ]; then
                echo "Would delete: $file" >&2
            else
                rm -f "$file"
                echo "Deleted: $file" >&2
            fi
        done < <(find "$output_dir" -type f -name "*.vtt" -mtime +$days -print0 2>/dev/null)
    fi
    
    # Remove empty directories
    if [ "$dry_run" = false ]; then
        find "$output_dir" -type d -empty -delete 2>/dev/null
    fi
    
    # Format sizes for display
    local audio_size_mb=$((audio_size / 1024 / 1024))
    local transcript_size_mb=$((transcript_size / 1024 / 1024))
    local total_size_mb=$((audio_size_mb + transcript_size_mb))
    
    echo "" >&2
    echo "📊 Summary:" >&2
    echo "   Audio files: $audio_count (${audio_size_mb} MB)" >&2
    if [ "$audio_only" = false ]; then
        echo "   Transcripts: $transcript_count (${transcript_size_mb} MB)" >&2
    fi
    echo "   Total space: ${total_size_mb} MB" >&2
    
    if [ "$dry_run" = true ]; then
        echo "" >&2
        echo "💡 This was a dry run. Run without --dry-run to actually delete files." >&2
    else
        echo "" >&2
        echo "✅ Cleanup complete!" >&2
    fi
}
