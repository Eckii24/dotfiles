while IFS= read -r -d '' name && IFS= read -r -d '' reference; do
  [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    print -u2 "Invalid environment-variable name: $name"
    return 1
  }
  [[ "$reference" == op://* ]] || {
    print -u2 "Invalid 1Password reference for $name"
    return 1
  }
  export "$name=$reference"
done < <(
  yq -er -0 '.secrets.onepassword.env | to_entries[] | [.key, .value] | .[]' \
    "$HOME/.hermes/config.yaml"
)
