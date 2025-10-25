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
          function() -- sidekick next edit suggestion
            return require("sidekick").nes_jump_or_apply()
          end,
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
        "<leader>fN",
        function()
          Snacks.picker.files({ cwd = vim.env.NOTES_DIR })
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
          projects = {
            dev = { "~/Development/" },
          },
          explorer = {
            win = {
              list = {
                keys = {
                  ["O"] = { { "pick_win", "jump" }, mode = { "n", "i" } },
                  ["A"] = "explorer_add_dotnet",
                  ["Y"] = "copy_path",
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
              copy_path = function(_, item)
                local modify = vim.fn.fnamemodify
                local filepath = item.file
                local filename = modify(filepath, ":t")
                local values = {
                  filepath,
                  modify(filepath, ":."),
                  modify(filepath, ":~"),
                  filename,
                  modify(filename, ":r"),
                  modify(filename, ":e"),
                }
                local items = {
                  "Absolute path: " .. values[1],
                  "Path relative to CWD: " .. values[2],
                  "Path relative to HOME: " .. values[3],
                  "Filename: " .. values[4],
                }
                if vim.fn.isdirectory(filepath) == 0 then
                  vim.list_extend(items, {
                    "Filename without extension: " .. values[5],
                    "Extension of the filename: " .. values[6],
                  })
                end
                vim.ui.select(items, { prompt = "Choose to copy to clipboard:" }, function(choice, i)
                  if not choice then
                    vim.notify("Selection cancelled")
                    return
                  end
                  if not i then
                    vim.notify("Invalid selection")
                    return
                  end
                  local result = values[i]
                  vim.fn.setreg('"', result) -- Neovim unnamed register
                  vim.fn.setreg("+", result) -- System clipboard
                  vim.notify("Copied: " .. result)
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
  {
    "folke/sidekick.nvim",
    keys = {
      {
        "<leader>ag",
        function()
          require("sidekick.cli").toggle({ name = "copilot", focus = true })
        end,
        desc = "Sidekick Toggle Copilot",
      },
      {
        "<leader>ao",
        function()
          require("sidekick.cli").toggle({ name = "opencode", focus = true })
        end,
        desc = "Sidekick Toggle Opencode",
      },
      { "<leader>aa", false },
      { "<leader>ac", false },
    },
  },
}
