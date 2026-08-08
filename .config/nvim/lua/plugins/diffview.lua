local function git_ref_exists(ref)
  local result = vim.fn.systemlist({ "git", "rev-parse", "--verify", "--quiet", ref })
  return vim.v.shell_error == 0 and result[1] ~= nil and result[1] ~= ""
end

local function base_ref(refs)
  for _, ref in ipairs(refs) do
    if git_ref_exists(ref) then
      return ref
    end
  end
end

local function open_base_diff(refs, label)
  local ref = base_ref(refs)

  if not ref then
    vim.notify("No " .. label .. " base branch found", vim.log.levels.ERROR)
    return
  end

  vim.cmd("DiffviewOpen " .. ref .. "...HEAD")
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
      "DiffviewToggle",
      "DiffviewToggleFiles",
      "DiffviewFocusFiles",
      "DiffviewFileHistory",
      "DiffviewDiffFiles",
      "DiffviewDiffDirs",
      "DiffviewMergeFiles",
    },
    keys = {
      { "<leader>fd", "<cmd>DiffviewToggle<cr>", desc = "Toggle Diffview" },
      { "<leader>gV", desc = "+diffview" },
      { "<leader>gVi", "<cmd>DiffviewOpen<cr>", desc = "HEAD to Current Index" },
      { "<leader>gVl", "<cmd>DiffviewOpen HEAD~1<cr>", desc = "Working Tree to Last Commit" },
      {
        "<leader>gVm",
        function()
          open_base_diff({ "main", "master" }, "local")
        end,
        desc = "Working Tree vs local main/master",
      },
      {
        "<leader>gVM",
        function()
          open_base_diff({ "origin/main", "origin/master" }, "remote")
        end,
        desc = "Working Tree vs origin/main/master",
      },
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
        enhanced_diff_hl = true,
        diffopt = {
          algorithm = "histogram",
        },
        persist_selections = {
          enabled = true,
        },
        view = {
          default = {
            layout = "diff2_horizontal",
            focus_diff = true,
          },
          merge_tool = {
            layout = "diff4_mixed",
            disable_diagnostics = true,
            winbar_info = true,
          },
          file_history = {
            layout = "diff2_vertical",
          },
          inline = {
            style = "unified",
            deletion_highlight = "hanging",
            deletion_treesitter = true,
          },
          cycle_layouts = {
            default = { "diff2_horizontal", "diff1_inline", "diff2_vertical" },
          },
        },
        file_panel = {
          show_branch_name = true,
          always_show_sections = true,
          always_show_marks = true,
          mark_placement = "sign_column",
        },
        file_history_panel = {
          stat_style = "both",
          date_format = "relative",
        },
        keymaps = {
          view = {
            ["q"] = "<cmd>DiffviewClose<cr>",

            -- AI review workflow
            ["<C-a>"] = ai_review.add_note,
            ["<C-n>"] = ai_review.open_notes,
            ["<C-t>"] = ai_review.toggle_note,
            ["<C-v>"] = ai_review.toggle_resolved_visibility,
          },
          file_panel = {
            ["q"] = "<cmd>DiffviewClose<cr>",

            -- File-Panel: öffnet Hinweis, Inline-Kommentare im Diff-Fenster setzen.
            ["<C-a>"] = ai_review.add_note,
            ["<C-n>"] = ai_review.open_notes,
            ["<C-t>"] = ai_review.toggle_note,
            ["<C-v>"] = ai_review.toggle_resolved_visibility,
          },
          file_history_panel = {
            ["q"] = "<cmd>DiffviewClose<cr>",
          },
        },
      }
    end,
  },
}
