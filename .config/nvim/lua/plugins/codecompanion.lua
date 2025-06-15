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
    opts = {},
  },
  {
    "olimorris/codecompanion.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
      { "MeanderingProgrammer/render-markdown.nvim", ft = { "markdown", "codecompanion" } },
      "ravitemer/mcphub.nvim",
    },
    opts = {
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
        },
        inline = {
          adapter = "copilot",
        },
      },
      extensions = {
        mcphub = {
          callback = "mcphub.extensions.codecompanion",
          opts = {
            make_vars = true,
            make_slash_commands = true,
            show_result_in_chat = true,
          },
        },
      },
    },
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
