return {
  {
    "sindrets/diffview.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "folke/snacks.nvim",
    },
    cmd = {
      "DiffviewOpen",
      "DiffviewClose",
      "DiffviewToggleFiles",
      "DiffviewFocusFiles",
      "DiffviewFileHistory",
    },
    keys = {
      { "<leader>gD", desc = "+diffview" },
      { "<leader>gDi", "<cmd>DiffviewOpen<cr>", desc = "HEAD to Current Index" },
      { "<leader>gDl", "<cmd>DiffviewOpen HEAD~1<cr>", desc = "HEAD to Last Commit" },
      { "<leader>gDm", "<cmd>DiffviewOpen origin/master<cr>", desc = "HEAD to Origin/master" },
      { "<leader>gDf", "<cmd>DiffviewFileHistory %<cr>", desc = "Current File History" },
      { "<leader>gDf", ":'<,'>DiffviewFileHistory<cr>", mode = "v", desc = "Current File History" },
      { "<leader>gDq", "<cmd>DiffviewClose<cr>", desc = "Quit" },
      {
        "<leader>gDc",
        function()
          require("snacks.picker").git_log({
            confirm = function (_, item)
              if item and item.commit then
                vim.cmd("DiffviewOpen " .. item.commit)
              end
            end,
          })
        end,
        desc = "HEAD to Commit (Picker)",
      },
      {
        "<leader>gDb",
        function()
          require("snacks.picker").git_branches({
            confirm = function (_, item)
              if item and item.branch then
                vim.cmd("DiffviewOpen " .. item.branch)
              end
            end
          })
        end,
        desc = "HEAD to Branch (Picker)",
      }
    },
    opts = {
      keymaps = {
        view = {
          ["q"] = "<cmd>DiffviewClose<cr>",
        },
        file_panel = {
          ["q"] = "<cmd>DiffviewClose<cr>",
        },
        file_history_panel = {
          ["q"] = "<cmd>DiffviewClose<cr>",
        },
      },
    },
  },
}
