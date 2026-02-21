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
      { "<leader>gV", desc = "+diffview" },
      { "<leader>gVi", "<cmd>DiffviewOpen<cr>", desc = "HEAD to Current Index" },
      { "<leader>gVl", "<cmd>DiffviewOpen HEAD~1<cr>", desc = "HEAD to Last Commit" },
      { "<leader>gVm", "<cmd>DiffviewOpen origin/master<cr>", desc = "HEAD to Origin/master" },
      { "<leader>gVM", "<cmd>DiffviewOpen origin/main<cr>", desc = "HEAD to Origin/main" },
      { "<leader>gVf", "<cmd>DiffviewFileHistory %<cr>", desc = "Current File History" },
      { "<leader>gVf", ":'<,'>DiffviewFileHistory<cr>", mode = "v", desc = "Current File History" },
      { "<leader>gVq", "<cmd>DiffviewClose<cr>", desc = "Quit" },
      {
        "<leader>gVc",
        function()
          require("snacks.picker").git_log({
            confirm = function(_, item)
              if item and item.commit then
                vim.cmd("DiffviewOpen " .. item.commit)
              end
            end,
          })
        end,
        desc = "HEAD to Commit (Picker)",
      },
      {
        "<leader>gVb",
        function()
          require("snacks.picker").git_branches({
            confirm = function(_, item)
              if item and item.branch then
                vim.cmd("DiffviewOpen " .. item.branch)
              end
            end,
          })
        end,
        desc = "HEAD to Branch (Picker)",
      },
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
