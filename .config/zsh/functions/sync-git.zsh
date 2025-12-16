gitsync() {
  if [ -z "$1" ]; then
    echo "Usage: gitsync /path/to/repo"
    return 1
  fi

  local REPO_PATH="$1"
  local COMMIT_MSG
  local DIFF_OUTPUT
  
  # Define the multi-line prompt template for easy reading and maintenance
  local AI_PROMPT_TEMPLATE="Generate a Git commit message based on the files listed below.

Your output must follow these rules strictly:
1.  **Subject Line (Line 1):** Must be a single line, imperative, and concise (ideally under 72 characters). It must start with a Conventional Commit type (e.g., 'feat', 'fix', 'docs', 'refactor') followed by a colon and a space (e.g., 'fix: Handle edge case in user login').
2.  **Blank Line (Line 2):** Must be completely empty.
3.  **Body (Line 3+):** Provide a detailed explanation of the change, focusing on the 'why' and 'what' if not obvious from the subject. Wrap the body text at 72 characters.
4.  **No Extra Text:** Do not include any headers, pre-amble, or markdown formatting (like code blocks) in your response, just the raw commit message text.

Files Changed:
"

  echo "🚀 Synchronizing repository at: $REPO_PATH"

  # Run commands in a subshell to avoid changing the current directory permanently
  (
    if ! cd "$REPO_PATH" 2>/dev/null; then
      echo "Error: Directory not found or not accessible: $REPO_PATH"
      return 1
    fi
    
    echo "1. Pulling latest changes from remote..."
    git pull || { echo "Error pulling changes. Resolve conflicts before continuing."; return 1; }

    echo "2. Staging all local files..."
    git add . || { echo "Error staging files."; return 1; }

    # Check if there are changes to commit
    DIFF_OUTPUT=$(git diff --cached)
    if [ -z "$DIFF_OUTPUT" ]; then
        echo "No local changes found to commit. Exiting."
        return 0
    fi
    
    echo "3. Generating commit message with aichat..."

    # Combine the template and the dynamic file list for the final prompt
    local FINAL_PROMPT="${AI_PROMPT_TEMPLATE}${DIFF_OUTPUT}"

    # *** CALL TO AI CHAT TOOL ***
    COMMIT_MSG=$(aichat "$FINAL_PROMPT" 2>/dev/null)

    if [ -z "$COMMIT_MSG" ]; then
      echo "Error: aichat failed or returned an empty message. Aborting commit."
      return 1
    fi
    
    echo "   -> Generated message:"
    # Use echo -e to interpret newlines for a clean printout
    echo -e "$COMMIT_MSG"

    echo "4. Committing changes..."
    # The message is quoted to handle the multi-line structure correctly
    git commit -m "$COMMIT_MSG" || { echo "Error during commit."; return 1; }

    echo "5. Pushing to remote..."
    git push || { echo "Error during push."; return 1; }

    echo "✅ Success! Pull, commit, and push complete."
  )
}
