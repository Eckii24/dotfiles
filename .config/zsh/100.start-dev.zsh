function start-dev() {
    # Help function
    function show_help() {
        echo "Usage: start-dev [OPTIONS]"
        echo ""
        echo "Start a development Docker container with specified configurations."
        echo ""
        echo "Options:"
        echo "  -d, --dir <path>          Specify the project directory to mount (optional)."
        echo "  -i, --image <image>       Specify the Docker image to use (default: dev-base:latest)."
        echo "  --ssh-port <port>         Specify the SSH port to use (default: 2222)."
        echo "  -p, --port <port>         Map additional ports (can be specified multiple times) (optional)."
        echo "  --identity <key>          Specify the SSH identity file (default: id_ed25519)."
        echo "  --name <name>             Set a name for the container (optional)."
        echo "  -e, --env <var=value>     Set environment variables (can be specified multiple times) (optional)."
        echo "  -v, --volume <volume>     Mount additional volumes (can be specified multiple times) (optional)."
        echo "  --network <network>       Specify the Docker network to connect to (optional)."
        echo "  --cpus <number>           Limit the number of CPUs for the container (optional)."
        echo "  -m, --memory <size>       Limit the memory for the container (optional)."
        echo "  --restart <policy>        Set the restart policy for the container (optional)."
        echo "  -w, --workdir <path>      Set the working directory inside the container (optional)."
        echo "  --no-rm                   Do not remove the container when it exits (optional)."
        echo ""
        echo "Examples:"
        echo "  start-dev --dir /path/to/project --image my-image:latest --name my-container"
        echo "  start-dev -d /path/to/project -p 8080:80 --env MY_VAR=value"
    }

    # Check for help flag
    if [[ "$1" == "--help" || "$1" == "-h" ]]; then
        show_help
        return 0
    fi

    local ssh_port=2222
    local image="dev-base:latest"
    local project_dir=""
    local rm_flag="--rm"
    local identity="id_ed25519"
    local port_mappings=()
    local env_vars=()
    local volumes=()
    local container_name=""
    local network=""
    local cpus=""
    local memory=""
    local restart_policy=""
    local workdir=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dir|-d)
                project_dir="$2"
                shift 2
                ;;
            --image|-i)
                image="$2"
                shift 2
                ;;
            --ssh-port)
                ssh_port="$2"
                shift 2
                ;;
            --port|-p)
                port_mappings+=("$2")
                shift 2
                ;;
            --identity)
                identity="$2"
                shift 2
                ;;
            --name)
                container_name="$2"
                shift 2
                ;;
            --env|-e)
                env_vars+=("$2")
                shift 2
                ;;
            --volume|-v)
                volumes+=("$2")
                shift 2
                ;;
            --network)
                network="$2"
                shift 2
                ;;
            --cpus)
                cpus="$2"
                shift 2
                ;;
            --memory|-m)
                memory="$2"
                shift 2
                ;;
            --restart)
                restart_policy="$2"
                shift 2
                ;;
            --workdir|-w)
                workdir="$2"
                shift 2
                ;;
            --no-rm)
                rm_flag=""
                shift
                ;;
            *)
                echo "Unknown option: $1"
                return 1
                ;;
        esac
    done

    # Prepare docker command
    local docker_cmd="docker run $rm_flag -d"

    # Add container name if specified
    if [[ -n "$container_name" ]]; then
        docker_cmd+=" --name $container_name"
    fi

    # Add SSH port mapping
    docker_cmd+=" -p $ssh_port:22"

    # Add additional port mappings if specified
    for port_mapping in "${port_mappings[@]}"; do
        docker_cmd+=" -p $port_mapping"
    done

    # Add environment variables
    for env_var in "${env_vars[@]}"; do
        docker_cmd+=" -e $env_var"
    done

    # Add network if specified
    if [[ -n "$network" ]]; then
        docker_cmd+=" --network $network"
    fi

    # Add resource limits if specified
    if [[ -n "$cpus" ]]; then
        docker_cmd+=" --cpus $cpus"
    fi

    if [[ -n "$memory" ]]; then
        docker_cmd+=" --memory $memory"
    fi

    # Add restart policy if specified
    if [[ -n "$restart_policy" ]]; then
        docker_cmd+=" --restart $restart_policy"
    fi

    # Add working directory if specified
    if [[ -n "$workdir" ]]; then
        docker_cmd+=" --workdir $workdir"
    fi

    # Add SSH key mount with the specified identity
    docker_cmd+=" -v ~/.ssh/$identity.pub:/root/.ssh/authorized_keys:ro"

    # Add zsh secrets mount
    docker_cmd+=" -v ~/.config/zsh/200.secrets.zsh:/root/.config/zsh/200.secrets.zsh:ro"

    # Add project directory mount if specified
    if [[ -n "$project_dir" ]]; then
        docker_cmd+=" -v $project_dir:/root/"
    fi

    # Add additional volume mounts
    for volume in "${volumes[@]}"; do
        docker_cmd+=" -v $volume"
    done

    # Add image
    docker_cmd+=" eckii24/$image"

    # Execute command
    echo "Executing: $docker_cmd"
    eval "$docker_cmd"

    # Report container ID if no name was specified
    if [[ -z "$container_name" ]]; then
        echo "Container started. SSH available on port $ssh_port."
    else
        echo "Container $container_name started. SSH available on port $ssh_port."
    fi
}
