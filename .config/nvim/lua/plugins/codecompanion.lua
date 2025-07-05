local function is_codecompanion_chat_buffer(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return false
  end

  -- Option 1: Check by filetype (REPLACE 'codecompanion_ft' with the actual filetype)
  local ft = vim.api.nvim_get_option_value("filetype", { buf = bufnr })
  if ft == "codecompanion" then
    return true
  end

  return false
end

-- Custom Lualine component function
local function codecompanion_modifiable_status()
  local current_bufnr = vim.api.nvim_get_current_buf()
  if is_codecompanion_chat_buffer(current_bufnr) then
    if not vim.api.nvim_get_option_value("modifiable", { buf = current_bufnr }) then
      return "✨ Working on an answer..."
    else
      return "📝 Ask me anything!" -- Or perhaps '✏️' to indicate editable
    end
  end
  return ""
end

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
          ["Create Pull Request"] = {
            strategy = "workflow",
            description = "Guided workflow to create a PR using MCP and LLM-generated description.",
            opts = {
              short_name = "pr",
              auto_submit = true,
            },
            prompts = {
              -- 1. Get git diff
              {
                {
                  name = "Get Git Diff",
                  role = "user",
                  content = "Run @cmd_runner: git diff origin/main...HEAD --name-status",
                  opts = { auto_submit = true },
                },
              },
              -- 2. Ask for work item ID
              {
                {
                  name = "Get DevOps Project",
                  role = "system",
                  content = function(ctx)
                    return "Use <value-from-env-AZURE_DEVOPS_PROJECT> as devops project"
                  end,
                },
                {
                  name = "Work Item ID",
                  role = "user",
                  content = "Please enter the work item ID for this implementation.",
                  opts = { auto_submit = false },
                },
              },
              -- 4. Get repository info
              {
                {
                  name = "Get Repo Info",
                  role = "user",
                  content = "Run @mcp:repo_get_repo_by_name_or_id with the given project and repository name.",
                  opts = {
                    auto_submit = true,
                  },
                },
              },
              -- 5. Get work item details
              {
                {
                  name = "Get Work Item",
                  role = "user",
                  content = "Run @mcp:wit_get_work_item with the given id and project",
                  opts = {
                    auto_submit = true,
                  },
                },
              },
              -- 6. Generate PR description with LLM
              {
                {
                  name = "Generate PR Description",
                  role = "user",
                  content = "Using the given context about the git diff and the work item.\n\nPlease generate a pull request title and a description using this structure:\n\n**Describe the changes you made**\n\n**Describe the design choices you made**\n\n# Review Information\nPlace any specific information for the PR reviewer to help improving the code quality.\n\n## Type of change",
                  opts = { auto_submit = true },
                },
              },
              -- 7. Show PR draft and ask for confirmation
              {
                {
                  name = "Confirm PR",
                  role = "user",
                  content = "Please create the pull request using @mcp:repo_create_pull_request with the given information.",
                  opts = { auto_submit = false },
                },
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
            },
          },
        },
        display = {
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
      { "<leader>ay", "<cmd>CodeCompanionChat Add<cr>", mode = "v", desc = "CodeCompanion add to chat" },
      { "<leader>ai", "<cmd>CodeCompanion<cr>", mode = { "n", "v" }, desc = "CodeCompanion inline" },
    },
  },
  {
    "nvim-lualine/lualine.nvim",
    opts = function(_, opts)
      table.insert(opts.sections.lualine_c, codecompanion_modifiable_status)
    end,
  },
}
