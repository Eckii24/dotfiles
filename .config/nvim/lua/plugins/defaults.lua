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
            -- 1) If a snippet is active, accept it
            if cmp.snippet_active() then
              return cmp.accept()
            end
            -- 2) Try to accept an inline LSP completion (copilot-native)
            local ok, res = pcall(function()
              if vim.lsp and vim.lsp.inline_completion and vim.lsp.inline_completion.get then
                return vim.lsp.inline_completion.get()
              end
            end)
            if ok and type(res) == "function" then
              -- call the accept function returned by the API
              pcall(res)
              return true
            end
            -- 3) Fallback to select_and_accept (existing behavior)
            return cmp.select_and_accept()
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
        actions = {
          explorer_paste = function(picker, item) --[[Override]]
            local Tree = require("snacks.explorer.tree")
            local files = vim.split(vim.fn.getreg(vim.v.register or "+") or "", "\n", { plain = true })
            files = vim.tbl_filter(function(file)
              -- NOTE: Use `vim.uv.fs_stat` instead of `vim.fn.filereadable`
              return file ~= "" and vim.uv.fs_stat(file) ~= nil
            end, files)
            if #files == 0 then
              return Snacks.notify.warn(("The `%s` register does not contain any files"):format(vim.v.register or "+"))
            end
            local dir = picker:dir()
            -- NOTE: Prefer parent when directory is closed
            if item.dir and not item.open then
              dir = vim.fs.dirname(dir)
            end
            -- NOTE: Replace `Snacks.picker.util.copy`
            for _, file in ipairs(files) do
              -- BUG: Prevent pasting inside itself
              if file == dir then
                Snacks.notify.warn(string.format("Skip recursive copy: %s", file))
              else
                local dst = vim.fs.joinpath(dir, vim.fn.fnamemodify(file, ":t"))
                local dst_unique = dst
                local count = 0
                while vim.uv.fs_stat(dst_unique) do
                  count = count + 1
                  dst_unique = string.format("%s (copy %d)", dst, count)
                end
                Snacks.picker.util.copy_path(file, dst_unique)
              end
            end
            Tree:refresh(dir)
            Tree:open(dir)
            picker:update({ target = dir })
          end,
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
  {
    "mfussenegger/nvim-lint",
    optional = true,
    opts = {
      linters = {
        ["markdownlint-cli2"] = {
          args = { "--config", vim.fn.expand("$HOME/.config/markdownlint-cli2/config.markdownlint-cli2.yaml"), "--" },
        },
      },
    },
  },
  {
    "stevearc/conform.nvim",
    opts = {
      formatters = {
        ["markdownlint-cli2"] = {
          args = {
            "--config",
            vim.fn.expand("$HOME/.config/markdownlint-cli2/config.markdownlint-cli2.yaml"),
            "--fix",
            "$FILENAME",
          },
        },
      },
    },
  },
}
