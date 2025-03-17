return {
  {
    "ravitemer/mcphub.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim", -- Required for Job and HTTP requests
    },
    cmd = "MCPHub", -- lazily start the hub when `MCPHub` is called
    build = "npm install -g mcp-hub@latest", -- Installs required mcp-hub npm module"ravitemer/mcphub.nvim",
    keys = {
      { "<leader>am", "<cmd>MCPHub<cr>", mode = "n", desc = "MCPHub" },
    },
    opts = {
      -- Required options
      port = 3000, -- Port for MCP Hub server
      config = vim.fn.expand("~/.config/nvim/mcpservers.json"), -- Absolute path to config file
      shutdown_delay = 0, -- Wait 0ms before shutting down server after last client exits
      log = {
        level = vim.log.levels.WARN,
        to_file = false,
        file_path = nil,
        prefix = "MCPHub",
      },
    },
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
        azure_openai = function()
          return require("codecompanion.adapters").extend("azure_openai", {
            env = {
              api_key = "AZURE_API_KEY",
              endpoint = "AZURE_API_BASE",
              api_version = "AZURE_API_VERSION",
            },
            schema = {
              model = {
                default = "o3-mini",
                choices = {
                  ["o3-mini"] = { opts = { can_reason = true } },
                  ["o1"] = { opts = { stream = false } },
                  ["o1-mini"] = { opts = { stream = true } },
                  "gpt-4o",
                  "gpt-4o-mini",
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
            ["mcp"] = {
              -- calling it in a function would prevent mcphub from being loaded before it's needed
              callback = function()
                return require("mcphub.extensions.codecompanion")
              end,
              description = "Call tools and resources from the MCP Servers",
              opts = {
                requires_approval = true,
              },
            },
          },
        },
        inline = {
          adapter = "copilot",
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
}
