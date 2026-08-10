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

local function diff_current_windows()
  local current_win = vim.api.nvim_get_current_win()
  local windows = {}

  for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    local bufnr = vim.api.nvim_win_get_buf(win)
    local name = vim.api.nvim_buf_get_name(bufnr)

    if vim.bo[bufnr].buftype == "" and name ~= "" then
      table.insert(windows, { win = win, name = name })
    end
  end

  if #windows ~= 2 then
    vim.notify("Open exactly two file panes before using <leader>fd", vim.log.levels.ERROR)
    return
  end

  local first = windows[1]
  local second = windows[2]
  if first.win ~= current_win then
    first, second = second, first
  end

  vim.cmd(
    "DiffviewDiffFiles " .. vim.fn.fnameescape(first.name) .. " " .. vim.fn.fnameescape(second.name)
  )
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
      { "<leader>fd", diff_current_windows, desc = "Diff current file panes" },
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
      local actions = require("diffview.actions")
      local lib = require("diffview.lib")
      local git_adapter = require("diffview.vcs.adapters.git").GitAdapter

      local function select_entry_focus_diff()
        local view = lib.get_current_view()
        if not view or not view.panel:is_open() then
          return
        end

        local item = view.panel:get_item_at_cursor()
        if not item then
          return
        end

        if type(item.collapsed) == "boolean" then
          view.panel:toggle_item_fold(item)
        else
          view:set_file(item, true)
        end
      end

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
            { "n", "g<C-x>", false },
            { "n", "gX", actions.cycle_layout, { desc = "Cycle through available layouts" } },

            -- AI review workflow
            { "n", "ga", ai_review.add_note, { desc = "Add Review Note" } },
            { "n", "gA", ai_review.open_notes, { desc = "Open Review Notes" } },
            { "n", "gm", ai_review.toggle_note, { desc = "Toggle Review Note" } },
            { "n", "gM", ai_review.toggle_resolved_visibility, { desc = "Toggle Resolved Review Notes" } },
          },
          file_panel = {
            ["q"] = "<cmd>DiffviewClose<cr>",
            ["<cr>"] = select_entry_focus_diff,
            { "n", "g<C-x>", false },
            { "n", "gX", actions.cycle_layout, { desc = "Cycle through available layouts" } },

            -- File-Panel: öffnet Hinweis, Inline-Kommentare im Diff-Fenster setzen.
            { "n", "ga", ai_review.add_note, { desc = "Add Review Note" } },
            { "n", "gA", ai_review.open_notes, { desc = "Open Review Notes" } },
            { "n", "gm", ai_review.toggle_note, { desc = "Toggle Review Note" } },
            { "n", "gM", ai_review.toggle_resolved_visibility, { desc = "Toggle Resolved Review Notes" } },
          },
          file_history_panel = {
            ["q"] = "<cmd>DiffviewClose<cr>",
            { "n", "g<C-x>", false },
            { "n", "gX", actions.cycle_layout, { desc = "Cycle through available layouts" } },
          },
        },
      }
    end,
  },
}
