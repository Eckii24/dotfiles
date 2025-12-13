return {
  {
    "vimwiki/vimwiki",
    init = function()
      vim.g.vimwiki_list = {
        {
          path = vim.fn.expand(vim.env.VIMWIKI_HOME),
          syntax = "markdown",
          ext = ".md",
        },
      }
      vim.g.vimwiki_global_ext = 0
      vim.g.vimwiki_markdown_link_ext = 1
      vim.g.vimwiki_auto_header = 1
      vim.g.vimwiki_folding = "list"
    end,
    keys = {
      { "<leader>W", desc = "Vimwiki" },

      { "<leader>Wi", "<Plug>VimwikiIndex", desc = "Index" },
      { "<leader>WI", "<Plug>VimwikiTabIndex", desc = "Index (Tab)" },

      { "<leader>Wd", desc = "Diary" },
      { "<leader>Wdi", "<Plug>VimwikiDiaryIndex", desc = "Index" },
      { "<leader>Wdg", "<Plug>VimwikiDiaryGenerateLinks", desc = "Generate Links" },
      { "<leader>Wdt", "<Plug>VimwikiMakeTomorrowDiaryNote", desc = "New Tomorrow Diary Note" },
      { "<leader>Wdn", "<Plug>VimwikiMakeDiaryNote", desc = "New Diary Note" },
      { "<leader>WdN", "<Plug>VimwikiTabMakeDiaryNote", desc = "New Diary Note (Tab)" },
      { "<leader>Wdy", "<Plug>VimwikiMakeYesterdayDiaryNote", desc = "New Yesterday Diary Note" },

      { "<leader>Wf", desc = "File" },
      { "<leader>Wfd", "<Plug>VimwikiDeleteFile", desc = "Delete" },
      { "<leader>Wfr", "<Plug>VimwikiRenameFile", desc = "Rename" },
      { "<leader>Wfh", "<Plug>Vimwiki2HTML", desc = "To HTML" },
      { "<leader>WfH", "<Plug>Vimwiki2HTMLBrowse", desc = "To HTML and Open" },

      { "<leader>Ws", "<Plug>VimwikiUISelect", desc = "UI Select" },
      { "<leader>Wg", "<Plug>VimwikiGoto", desc = "Goto" },
      { "<leader>Wc", "<Plug>VimwikiColorize", desc = "Colorize" },
      { "<leader>WC", "<Plug>VimwikiColorizeNormal", desc = "Colorize Normal" },
    },
  },
  {
    "tbabej/taskwiki",
    init = function()
      vim.g.python3_host_prog = "~/.config/task/.venv/bin/python3"
      vim.g.taskwiki_taskrc_location = "~/.config/task/taskrc"
    end,
  },
}
