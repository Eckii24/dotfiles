return {
  {
    "akinsho/bufferline.nvim",
    enabled = false,
  },
  {
    "saghen/blink.cmp",
    opts = {
      keymap = {
        ["<Tab>"] = {
          function(cmp)
            if cmp.snippet_active() then
              return cmp.accept()
            else
              return cmp.select_and_accept()
            end
          end,
          "snippet_forward",
          "fallback",
        },
        ["<S-Tab>"] = { "snippet_backward", "fallback" },
        ["<C-k>"] = { "select_prev", "fallback" },
        ["<C-j>"] = { "select_next", "fallback" },
      },
    },
  },
  {
    "folke/flash.nvim",
    opts = {
      modes = {
        search = {
          enabled = true,
        },
      },
    },
  },
  {
    "folke/snacks.nvim",
    keys = {
      {
        "<leader>gB",
        function()
          Snacks.picker.git_branches()
        end,
        desc = "Git Branches",
      },
      {
        "<leader>gL",
        function()
          Snacks.picker.git_log_line()
        end,
        desc = "Git Log Line",
      },
      {
        "<leader>gf",
        function()
          Snacks.picker.git_log_file()
        end,
        desc = "Git Log File",
      },
      {
        "<leader>fn",
        function()
          local notes_dir = vim.env.NOTES_DIR or "~/Development/Repos/Notes"
          Snacks.picker.files({
            cwd = notes_dir,
          })
        end,
        desc = "Find Notes",
      },
    },
    opts = {
      terminal = {
        win = {
          style = "float",
        },
      },
      picker = {
        sources = {
          explorer = {
            win = {
              list = {
                keys = {
                  ["O"] = { { "pick_win", "jump" }, mode = { "n", "i" } },
                  ["A"] = "explorer_add_dotnet",
                },
              },
            },
            actions = {
              explorer_add_dotnet = function(picker)
                local dir = picker:dir()
                local tree = require("snacks.explorer.tree")
                local actions = require("snacks.explorer.actions")
                local easydotnet = require("easy-dotnet")

                easydotnet.create_new_item(dir, function(item_path)
                  tree:open(dir)
                  tree:refresh(dir)
                  actions.update(picker, { target = item_path })
                end)
              end,
            },
          },
        },
      },
      dashboard = {
        preset = {
          keys = {
            { icon = "󰚩", key = "a", desc = "CodeCompanion", action = ":CodeCompanionChat" },
            { icon = " ", key = "n", desc = "New File", action = ":ene | startinsert" },
            {
              icon = " ",
              key = "c",
              desc = "Config",
              action = ":lua Snacks.dashboard.pick('files', {cwd = vim.fn.stdpath('config')})",
            },
            { icon = " ", key = "s", desc = "Restore Session", section = "session" },
            { icon = " ", key = "x", desc = "Lazy Extras", action = ":LazyExtras" },
            { icon = "󰒲 ", key = "l", desc = "Lazy", action = ":Lazy" },
            { icon = " ", key = "q", desc = "Quit", action = ":qa" },
          },
        },
        sections = {
          { section = "header" },
          { section = "keys", gap = 1, padding = 2 },
          {
            icon = " ",
            title = "Recent Files (cwd)",
            section = "recent_files",
            indent = 2,
            padding = 2,
            cwd = true,
          },
          { icon = " ", title = "Recent Files", section = "recent_files", indent = 2, padding = 2, cwd = false },
          {
            icon = " ",
            title = "Git Status",
            section = "terminal",
            enabled = function()
              return Snacks.git.get_root() ~= nil
            end,
            cmd = "git status --short --branch --renames",
            height = 5,
            padding = 1,
            ttl = 5 * 60,
            indent = 3,
          },
          { section = "startup" },
        },
      },
    },
  },
  {
    "folke/todo-comments.nvim",
    opts = {
      highlight = {
        pattern = [[.*<(KEYWORDS)\s*]],
      },
      search = {
        pattern = [[\b(KEYWORDS)]],
      },
    },
  },
  {
    "lewis6991/gitsigns.nvim",
    keys = {
      {
        "<leader>h",
        "",
        desc = "+hunks",
      },
      {
        "<leader>hb",
        "<cmd>Gitsigns blame_line<cr>",
        desc = "Blame Line",
      },
      {
        "<leader>hB",
        "<cmd>Gitsigns blame<cr>",
        desc = "Blame Buffer",
      },
      {
        "<leader>hs",
        "<cmd>Gitsigns stage_hunk<cr>",
        desc = "Stage Hunk",
      },
      {
        "<leader>hS",
        "<cmd>Gitsigns stage_buffer<cr>",
        desc = "Stage Buffer",
      },
      {
        "<leader>hr",
        "<cmd>Gitsigns reset_hunk<cr>",
        desc = "Reset Hunk",
      },
      {
        "<leader>hR",
        "<cmd>Gitsigns reset_buffer<cr>",
        desc = "Reset Buffer",
      },
      {
        "<leader>hu",
        "<cmd>Gitsigns undo_stage_hunk<cr>",
        desc = "Undo Stage Hunk",
      },
      {
        "<leader>hp",
        "<cmd>Gitsigns preview_hunk_inline<cr>",
        desc = "Preview Hunk Inline",
      },
    },
  },
}
