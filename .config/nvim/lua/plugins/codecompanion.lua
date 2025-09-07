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
    },
    cmd = "CodeCompanionChat",
    opts = function()
      local layout = vim.env.CC_LAYOUT_OVERRIDE or "vertical"
      return {
        adapters = {
          http = {
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
                      "gpt-5",
                      "gpt-5-mini",
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
          rules_loader = {
            enabled = true,
            opts = {
              paths = {
                "AGENTS.md",
                ".github/copilot-instructions.md",
                ".github/instructions/**/*",
                ".kilocode/rules/**/*",
                "~/.kilocode/rules/**/*",
              },
            },
            callback = "codecompanion._extensions.rules_loader",
          },
          copilot_prompts = {
            enabled = true,
            opts = {
              content_prefix = "Current file: #{buffer}. Current structure #{ls}. Use #{rules}.Act as @{full_stack_dev}.",
            },
            callback = "codecompanion._extensions.copilot_prompts",
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
