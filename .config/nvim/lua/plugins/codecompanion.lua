return {
  {
    "ravitemer/mcphub.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim", -- Required for Job and HTTP requests
    },
    cmd = "MCPHub",
    build = "npm install -g mcp-hub@latest", -- Installs required mcp-hub npm module"ravitemer/mcphub.nvim",
    keys = {
      { "<leader>am", "<cmd>MCPHub<cr>", mode = "n", desc = "MCPHub" },
    },
    opts = {
      shutdown_delay = 24 * 60 * 60 * 1000, -- 24 hours in milliseconds
    },
  },
  {
    "olimorris/codecompanion.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
      { "MeanderingProgrammer/render-markdown.nvim", ft = { "markdown", "codecompanion" } },
      "ravitemer/mcphub.nvim",
      "ravitemer/codecompanion-history.nvim",
      "franco-ruggeri/codecompanion-spinner.nvim",
      "lazymaniac/codecompanion-reasoning.nvim",
    },
    cmd = "CodeCompanionChat",
    opts = function()
      local layout = vim.env.CC_LAYOUT_OVERRIDE or "vertical"
      return {
        adapters = {
          open_router = function()
            return require("codecompanion.adapters").extend("openai_compatible", {
              env = {
                api_key = "OPEN_ROUTER_API_KEY",
                url = "OPEN_ROUTER_API_URL",
              },
            })
          end,
          azure_openai = function()
            return require("codecompanion.adapters").extend("azure_openai", {
              env = {
                api_key = "AZURE_API_KEY",
                endpoint = "AZURE_API_BASE",
                api_version = "AZURE_API_VERSION",
              },
              schema = {
                model = {
                  default = "o4-mini",
                  choices = {
                    "gpt-4.1",
                    "gpt-4.1-mini",
                    "gpt-4o",
                    "gpt-4o-mini",
                    ["o1"] = { opts = { can_reason = true } },
                    ["o1-mini"] = { opts = { can_reason = true } },
                    ["o3"] = { opts = { can_reason = true } },
                    ["o3-mini"] = { opts = { can_reason = true } },
                    ["o4-mini"] = { opts = { can_reason = true } },
                  },
                },
              },
            })
          end,
        },
        strategies = {
          chat = {
            adapter = "copilot",
            keymaps = {
              close = {
                modes = {
                  n = "q",
                },
                index = 3,
                callback = "keymaps.close",
                description = "Close Chat",
              },
              stop = {
                modes = {
                  n = "<C-c",
                },
                index = 4,
                callback = "keymaps.stop",
                description = "Stop Request",
              },
            },
            tools = {
              opts = {
                auto_submit_errors = true,
                auto_submit_success = true,
                wait_timeout = 3600000, -- 1 hour
              },
            },
            roles = {
              llm = function(adapter)
                return string.format(
                  "  %s%s",
                  adapter.formatted_name,
                  adapter.schema.model.default and " (" .. adapter.schema.model.default .. ")" or ""
                )
              end,
            },
            variables = {
              ["ls"] = {
                callback = function()
                  local handle = io.popen("eza -T --git-ignore")
                  if handle then
                    local result = handle:read("*a")
                    handle:close()
                    return result
                  else
                    return "Unable to load directory structure."
                  end
                end,
                description = "Recursively lists the directory and file structure of the current working folder.",
                opts = {
                  contains_code = false,
                },
              },
            },
          },
          inline = {
            adapter = "copilot",
          },
        },
        prompt_library = {
          ["Agent-Mode Current Buffer"] = {
            strategy = "chat",
            description = "Already give the current buffer and the agent tools to the chat window",
            opts = {
              is_slash_cmd = true,
              auto_submit = false,
              short_name = "agent_mode_current_buffer",
            },
            prompts = {
              {
                role = "user",
                content = [[You are a @{full_stack_dev} with access to #{buffer}. The current project structure is #{ls} and you can reference project rules via #{rules}.

]],
              },
            },
          },
          ["Load Work Item"] = {
            strategy = "chat",
            description = "Load work item details using MCP",
            opts = {
              short_name = "load_work_item",
              is_slash_cmd = true,
              auto_submit = false,
            },
            prompts = {
              {
                role = "user",
                content = [[
### Instructions
Use the @{mcp} tool to load the details for an azure work item using MCP. 
Extract the description of the work item and present it in a useful way.

### Input
Project: VIS - Program 0
WorkItemID: ]],
              },
            },
          },
          ["Diff code review"] = {
            strategy = "chat",
            description = "Perform a code review",
            opts = {
              auto_submit = true,
              user_prompt = false,
            },
            prompts = {
              {
                role = "user",
                content = function()
                  local target_branch = vim.fn.input("Target branch for merge base diff (default: master): ", "master")

                  return string.format(
                    [[
                    You are a senior software engineer performing a code review. Analyze the following code changes.
                    Identify any potential bugs, performance issues, security vulnerabilities, or areas that could be refactored for better readability or maintainability.
                    Explain your reasoning clearly and provide specific suggestions for improvement.
                    Consider edge cases, error handling, and adherence to best practices and coding standards.
                    Here are the code changes:
                    ```
                    %s
                    ```
                    ]],
                    vim.fn.system("git diff --merge-base " .. target_branch)
                  )
                end,
              },
            },
          },
          ["Beast Mode"] = {
            strategy = "chat",
            description = "Use the VSCode Beast Mode prompt",
            opts = {
              auto_submit = false,
              user_prompt = false,
              short_name = "beast_mode_3_1",
              is_slash_cmd = true,
            },
            prompts = {
              {
                role = "user",
                content = [[
### Beast Mode 3.1

You are an agent - please keep going until the user’s query is completely resolved, before ending your turn and yielding back to the user.

Your thinking should be thorough and so it's fine if it's very long. However, avoid unnecessary repetition and verbosity. You should be concise, but thorough.

You MUST iterate and keep going until the problem is solved.

You have everything you need to resolve this problem. I want you to fully solve this autonomously before coming back to me.

Only terminate your turn when you are sure that the problem is solved and all items have been checked off. Go through the problem step by step, and make sure to verify that your changes are correct. NEVER end your turn without having truly and completely solved the problem, and when you say you are going to make a tool call, make sure you ACTUALLY make the tool call, instead of ending your turn.

THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH.

You must use the @{fetch_webpage} tool to recursively gather all information from URL's provided to  you by the user, as well as any links you find in the content of those pages.

Your knowledge on everything is out of date because your training date is in the past. 

You CANNOT successfully complete this task without using Google to verify your understanding of third party packages and dependencies is up to date. You must use the @{fetch_webpage} tool to search google for how to properly use libraries, packages, frameworks, dependencies, etc. every single time you install or implement one. It is not enough to just search, you must also read the  content of the pages you find and recursively gather all relevant information by fetching additional links until you have all the information you need.

Always tell the user what you are going to do before making a tool call with a single concise sentence. This will help them understand what you are doing and why.

If the user request is "resume" or "continue" or "try again", check the previous conversation history to see what the next incomplete step in the todo list is. Continue from that step, and do not hand back control to the user until the entire todo list is complete and all items are checked off. Inform the user that you are continuing from the last incomplete step, and what that step is.

Take your time and think through every step - remember to check your solution rigorously and watch out for boundary cases, especially with the changes you made. Use the sequential thinking tool if available. Your solution must be perfect. If not, continue working on it. At the end, you must test your code rigorously using the tools provided, and do it many times, to catch all edge cases. If it is not robust, iterate more and make it perfect. Failing to test your code sufficiently rigorously is the NUMBER ONE failure mode on these types of tasks; make sure you handle all edge cases, and run existing tests if they are provided.

You MUST plan extensively before each function call, and reflect extensively on the outcomes of the previous function calls. DO NOT do this entire process by making function calls only, as this can impair your ability to solve the problem and think insightfully.

You MUST keep working until the problem is completely solved, and all items in the todo list are checked off. Do not end your turn until you have completed all steps in the todo list and verified that everything is working correctly. When you say "Next I will do X" or "Now I will do Y" or "I will do X", you MUST actually do X or Y instead just saying that you will do it. 

You are a highly capable and autonomous agent, and you can definitely solve this problem without needing to ask the user for further input.

### Workflow
1. Fetch any URL's provided by the user using the `@{fetch_webpage}` tool.
2. Understand the problem deeply. Carefully read the issue and think critically about what is required. Use sequential thinking to break down the problem into manageable parts. Consider the following:
   - What is the expected behavior?
   - What are the edge cases?
   - What are the potential pitfalls?
   - How does this fit into the larger context of the codebase?
   - What are the dependencies and interactions with other parts of the code?
3. Investigate the codebase. Explore relevant files, search for key functions, and gather context.
4. Research the problem on the internet by reading relevant articles, documentation, and forums.
5. Develop a clear, step-by-step plan. Break down the fix into manageable, incremental steps. Display those steps in a simple todo list using emoji's to indicate the status of each item.
6. Implement the fix incrementally. Make small, testable code changes.
7. Debug as needed. Use debugging techniques to isolate and resolve issues.
8. Test frequently. Run tests after each change to verify correctness.
9. Iterate until the root cause is fixed and all tests pass.
10. Reflect and validate comprehensively. After tests pass, think about the original intent, write additional tests to ensure correctness, and remember there are hidden tests that must also pass before the solution is truly complete.

Refer to the detailed sections below for more information on each step.

#### 1. Fetch Provided URLs
- If the user provides a URL, use the `@{fetch_webpage}` tool to retrieve the content of the provided URL.
- After fetching, review the content returned by the fetch tool.
- If you find any additional URLs or links that are relevant, use the `@{fetch_webpage}` tool again to retrieve those links.
- Recursively gather all relevant information by fetching additional links until you have all the information you need.

#### 2. Deeply Understand the Problem
Carefully read the issue and think hard about a plan to solve it before coding.

#### 3. Codebase Investigation
- Explore relevant files and directories.
- Search for key functions, classes, or variables related to the issue.
- Read and understand relevant code snippets.
- Identify the root cause of the problem.
- Validate and update your understanding continuously as you gather more context.

#### 4. Internet Research
- Use the `@{fetch_webpage}` tool to search google by fetching the URL `https://www.google.com/search?q=your+search+query`.
- After fetching, review the content returned by the fetch tool.
- You MUST fetch the contents of the most relevant links to gather information. Do not rely on the summary that you find in the search results.
- As you fetch each link, read the content thoroughly and fetch any additional links that you find withhin the content that are relevant to the problem.
- Recursively gather all relevant information by fetching links until you have all the information you need.

#### 5. Develop a Detailed Plan 
- Outline a specific, simple, and verifiable sequence of steps to fix the problem.
- Create a todo list in markdown format to track your progress.
- Each time you complete a step, check it off using `[x]` syntax.
- Each time you check off a step, display the updated todo list to the user.
- Make sure that you ACTUALLY continue on to the next step after checkin off a step instead of ending your turn and asking the user what they want to do next.

#### 6. Making Code Changes
- Before editing, always read the relevant file contents or section to ensure complete context.
- Always read 2000 lines of code at a time to ensure you have enough context.
- If a patch is not applied correctly, attempt to reapply it.
- Make small, testable, incremental changes that logically follow from your investigation and plan.
- Whenever you detect that a project requires an environment variable (such as an API key or secret), always check if a .env file exists in the project root. If it does not exist, automatically create a .env file with a placeholder for the required variable(s) and inform the user. Do this proactively, without waiting for the user to request it.

### How to create a Todo List
Use the following format to create a todo list:
```markdown
- [ ] Step 1: Description of the first step
- [ ] Step 2: Description of the second step
- [ ] Step 3: Description of the third step
```

Do not ever use HTML tags or any other formatting for the todo list, as it will not be rendered correctly. Always use the markdown format shown above. Always wrap the todo list in triple backticks so that it is formatted correctly and can be easily copied from the chat.

Always show the completed todo list to the user as the last item in your message, so that they can see that you have addressed all of the steps.

### Communication Guidelines
Always communicate clearly and concisely in a casual, friendly yet professional tone. 
<examples>
"Let me fetch the URL you provided to gather more information."
"Ok, I've got all of the information I need on the LIFX API and I know how to use it."
"Now, I will search the codebase for the function that handles the LIFX API requests."
"I need to update several files here - stand by"
"OK! Now let's run the tests to make sure everything is working correctly."
"Whelp - I see we have some problems. Let's fix those up."
</examples>

- Respond with clear, direct answers. Use bullet points and code blocks for structure. - Avoid unnecessary explanations, repetition, and filler.  
- Always write code directly to the correct files.
- Do not display code to the user unless they specifically ask for it.
- Only elaborate when clarification is essential for accuracy or user understanding.

### Writing Prompts
If you are asked to write a prompt,  you should always generate the prompt in markdown format.

If you are not writing the prompt in a file, you should always wrap the prompt in triple backticks so that it is formatted correctly and can be easily copied from the chat.

Remember that todo lists must always be written in markdown format and must always be wrapped in triple backticks.

### Git 
If the user tells you to stage and commit, you may do so. 

You are NEVER allowed to stage and commit files automatically.

### Tools and Context
You are should act as @{full_stack_dev}.
The current projects structure looks like #{ls}, the open file is #{buffer}, and you have access to project rules via #{rules}.
                ]],
              },
            },
          },
        },
        extensions = {
          mcphub = {
            callback = "mcphub.extensions.codecompanion",
            opts = {
              make_vars = true,
              make_slash_commands = true,
              -- show_result_in_chat = true,
            },
          },
          history = {
            enabled = true,
            opts = {
              picker = "snacks",
              title_generation_opts = {
                adapter = "copilot",
                model = "gpt-4.1",
              },
            },
          },
          spinner = {},
          reasoning = { callback = "codecompanion._extensions.reasoning", opts = { enabled = true } },
          rules_loader = {
            enabled = true,
            opts = {
              paths = {
                "AGENTS.md",
              },
            },
            callback = "codecompanion._extensions.rules_loader",
          },
        },
        display = {
          diff = {
            enabled = false, -- disable diff approvals.
          },
          chat = {
            window = {
              layout = layout,
            },
          },
        },
      }
    end,
    keys = {
      { "<leader>a", "", desc = "ai" },
      { "<leader>aa", "<cmd>CodeCompanionActions<cr>", mode = { "n", "v" }, desc = "CodeCompanion actions" },
      { "<leader>ac", "<cmd>CodeCompanionChat Toggle<cr>", mode = { "n", "v" }, desc = "CodeCompanion chat" },
      {
        "<leader>aC",
        "<cmd>CodeCompanion /agent_mode_current_buffer<cr>",
        mode = { "n" },
        desc = "CodeCompanion chat in agent mode for current buffer",
      },
      { "<leader>ay", "<cmd>CodeCompanionChat Add<cr>", mode = "v", desc = "CodeCompanion add to chat" },
      { "<leader>ai", "<cmd>CodeCompanion<cr>", mode = { "n", "v" }, desc = "CodeCompanion inline" },
    },
  },
}
