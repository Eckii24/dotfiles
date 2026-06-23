local function git_ref_exists(ref)
  local result = vim.fn.systemlist({ "git", "rev-parse", "--verify", "--quiet", ref })
  return vim.v.shell_error == 0 and result[1] ~= nil and result[1] ~= ""
end

local function default_base_ref()
  for _, ref in ipairs({ "origin/main", "origin/master", "main", "master" }) do
    if git_ref_exists(ref) then
      return ref
    end
  end
end

local function open_default_base_diff()
  local ref = default_base_ref()

  if not ref then
    vim.notify("No base branch found: origin/main, origin/master, main, master", vim.log.levels.ERROR)
    return
  end

  vim.cmd("DiffviewOpen " .. ref)
end

return {
  {
    "dlyongemallo/diffview-plus.nvim",
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
      { "<leader>gVl", "<cmd>DiffviewOpen HEAD~1<cr>", desc = "Working Tree to Last Commit" },
      { "<leader>gVm", open_default_base_diff, desc = "Working Tree to main/master" },
      { "<leader>gVf", "<cmd>DiffviewFileHistory %<cr>", desc = "Current File History" },
      { "<leader>gVf", ":'<,'>DiffviewFileHistory<cr>", mode = "v", desc = "Current File History" },
      { "<leader>gVq", "<cmd>DiffviewClose<cr>", desc = "Quit" },
      {
        "<leader>gVa",
        function()
          require("config.diffview_ai_review").open_notes()
        end,
        desc = "Open AI Review Notes",
      },
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
        desc = "Working Tree to Commit (Picker)",
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
        desc = "Working Tree to Branch (Picker)",
      },
    },
    opts = function()
      local ai_review = require("config.diffview_ai_review")
      local git_adapter = require("diffview.vcs.adapters.git").GitAdapter
      ai_review.setup()

      if not git_adapter._show_untracked_override then
        local orig_show_untracked = git_adapter.show_untracked

        function git_adapter:show_untracked(opt)
          opt = opt or {}

          if opt.dv_opt and opt.dv_opt.show_untracked == true then
            return true
          end

          return orig_show_untracked(self, opt)
        end

        git_adapter._show_untracked_override = true
      end

      return {
        default_args = {
          DiffviewOpen = { "--imply-local", "--untracked-files=all" },
        },
        keymaps = {
          view = {
            ["q"] = "<cmd>DiffviewClose<cr>",

            -- AI review workflow
            ["a"] = ai_review.add_note,
            ["A"] = ai_review.open_notes,
          },
          file_panel = {
            ["q"] = "<cmd>DiffviewClose<cr>",

            -- File-Panel: öffnet Hinweis, Inline-Kommentare im Diff-Fenster setzen.
            ["a"] = ai_review.add_note,
            ["A"] = ai_review.open_notes,
          },
          file_history_panel = {
            ["q"] = "<cmd>DiffviewClose<cr>",
          },
        },
      }
    end,
  },
}
