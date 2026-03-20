return {
  {
    "olimorris/codecompanion.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
      "ravitemer/codecompanion-history.nvim",
      "lalitmee/codecompanion-spinners.nvim",
      "folke/snacks.nvim",
      "dyamon/codecompanion-copilot-enterprise.nvim",
      "cairijun/codecompanion-agentskills.nvim",
    },
    cmd = "CodeCompanionChat",
    opts = function()
      -- hacky solution to override the GitHub Copilot API base URL
      -- this is needed because CodeCompanion currently hard override the url
      do
        local http = require("codecompanion.http")

        -- keep original function CC captured
        local orig_post = http.static.methods.post.default

        http.static.methods.post.default = function(opts)
          if opts and opts.url == "https://api.githubcopilot.com/chat/completions" and vim.env.COPILOT_API_BASE then
            opts = vim.tbl_deep_extend("force", opts, {
              url = vim.env.COPILOT_API_BASE .. "/chat/completions",
            })
          end
          return orig_post(opts)
        end
      end

      return {
        adapters = {
          http = {
            azure_openai = function()
              return require("codecompanion.adapters.http").extend("azure_openai", {
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
            copilot = function()
              if vim.env.COPILOT_BASE and vim.env.COPILOT_BASE ~= "githubcopilot.com" then
                return require("codecompanion.adapters.http").extend("copilot_enterprise", {
                  opts = {
                    provider_url = vim.env.COPILOT_BASE,
                  },
                })
              end

              return require("codecompanion.adapters.http.copilot")
            end,
          },
          acp = {
            copilot_cli = function()
              return require("codecompanion.adapters.acp").extend("opencode", {
                name = "copilot_cli",
                formatted_name = "Copilot CLI",
                commands = {
                  default = {
                    "copilot",
                    "--acp",
                  },
                },
              })
            end,
          },
        },
        interactions = {
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
            editor_context = {
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
          cli = {
            agent = "pi",
            agents = {
              pi = {
                cmd = "pi",
                args = {},
                description = "pi Agent",
                provider = "terminal",
              },
              opencode = {
                cmd = "opencode",
                args = {},
                description = "OpenCode Agent",
                provider = "terminal",
              },
              copilot = {
                cmd = "copilot",
                args = {},
                description = "GitHub Copilot Agent",
                provider = "terminal",
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
              alias = "agent_mode_current_buffer",
            },
            prompts = {
              {
                role = "user",
                content = [[You are an @{agent} with access to #{context}. The current project structure is #{ls}.

]],
              },
            },
          },
        },
        extensions = {
          history = {
            enabled = true,
            opts = {
              picker = "snacks",
              title_generation_opts = {
                adapter = "copilot",
                model = "gpt-5-mini",
              },
            },
          },
          spinner = {
            opts = {
              style = "snacks",
            },
          },
          agentskills = {
            opts = {
              paths = {
                "~/.agents/skills",
                ".github/skills",
              },
            },
          },
        },
        display = {
          diff = {
            enabled = false, -- disable diff approvals.
          },
          chat = {
            window = {
              layout = vim.env.CC_LAYOUT_OVERRIDE or "vertical",
            },
          },
        },
        rules = {
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
      { "<leader>ap", "<cmd>CodeCompanionCLI agent=pi<cr>", mode = { "n", "v" }, desc = "CodeCompanionCLI with pi" },
      {
        "<leader>ag",
        "<cmd>CodeCompanionCLI agent=copilot<cr>",
        mode = { "n", "v" },
        desc = "CodeCompanionCLI with Copilot",
      },
      {
        "<leader>ao",
        "<cmd>CodeCompanionCLI agent=opencode<cr>",
        mode = { "n", "v" },
        desc = "CodeCompanionCLI with OpenCode",
      },
    },
  },
}
