function remove-password(){
  # Check if the correct number of arguments is provided
  if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <password> <folder_path>"
    exit 1
  fi

  password="$1"
  folder_path="$2"

  # Function to remove password from a PDF file
  remove_password() {
    input_pdf="$1"
    output_pdf="${input_pdf%.*}_decrypted.pdf"

    if qpdf --password="$password" --decrypt "$input_pdf" "$output_pdf"; then
      echo "Password removed successfully. Saved to $output_pdf"
    else
      echo "Failed to remove password from $input_pdf"
    fi
  }

echo "Start processing files in $folder_path"

# Process all PDF files in the specified folder
shopt -s nullglob # Ensure the loop skips if no files match
for file in "$folder_path"/*.pdf; do
  echo "Process $file"
  if [ -f "$file" ]; then
    remove_password "$file"
  fi
done

echo "Processing completed..."

}
