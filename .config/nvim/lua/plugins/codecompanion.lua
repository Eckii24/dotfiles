return {
  {
    "ravitemer/mcphub.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    cmd = "MCPHub",
    build = "npm install -g mcp-hub@latest",
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
      "lalitmee/codecompanion-spinners.nvim",
      "folke/snacks.nvim",
    },
    cmd = "CodeCompanionChat",
    opts = function()
      local layout = vim.env.CC_LAYOUT_OVERRIDE or "vertical"
      return {
        adapters = {
          http = {
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
            adapter = {
              name = "copilot",
              model = "gpt-5-mini",
            },
            keymaps = {
              close = {
                modes = {
                  n = "q",
                },
                index = 4,
                callback = "keymaps.close",
                description = "Close Chat",
              },
              stop = {
                modes = {
                  n = "gs",
                },
                index = 5,
                callback = "keymaps.stop",
                description = "Stop Request",
              },
              system_prompt = {
                modes = { n = "gP" },
                index = 17,
                callback = "keymaps.toggle_system_prompt",
                description = "Toggle system prompt",
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
                  adapter.schema and adapter.schema.model.default and " (" .. adapter.schema.model.default .. ")" or ""
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
            adapter = {
              name = "copilot",
              model = "gpt-5-mini",
            },
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
                content = [[You are a @{full_stack_dev} with access to #{buffer}. The current project structure is #{ls}.

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
          spinner = {
            opts = {
              style = "snacks",
            },
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
        memory = {
          default = {
            description = "Collection of common files for all projects",
            files = {
              "AGENTS.md",
              ".github/copilot-instructions.md",
              ".github/instructions/**/*",
              "$APPDATA/Code/User/prompts/*.instructions.md",
            },
          },
          opts = {
            chat = {
              enabled = true,
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
