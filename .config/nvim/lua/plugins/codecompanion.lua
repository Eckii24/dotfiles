return {
  {
    "olimorris/codecompanion.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
      { "MeanderingProgrammer/render-markdown.nvim", ft = { "markdown", "codecompanion" } },
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
