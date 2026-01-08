return {
  {
    "obsidian-nvim/obsidian.nvim",
    ft = "markdown",
    cmd = { "Obsidian" },
    opts = {
      daily_notes = {
        folder = "diary",
      },
      frontmatter = {
        enabled = false,
      },
      ui = {
        enable = false,
      },
      workspaces = {
        {
          name = "Wiki",
          path = vim.fn.expand(vim.env.WIKI_HOME),
        },
      },
    },
    keys = {
      { "<leader>W", desc = "Obsidian" },

      { "<leader>Wi", "<cmd>Obsidian quick_switch<cr>", desc = "Quick Switch" },
      { "<leader>WI", "<cmd>Obsidian open index<cr>", desc = "Index" },

      { "<leader>WD", "<cmd>Obsidian today<cr>", desc = "New Daily Note (Today)" },
      { "<leader>Wd", desc = "Diary" },
      { "<leader>Wdi", "<cmd>Obsidian dailies -7 3<cr>", desc = "Index" },
      { "<leader>Wdt", "<cmd>Obsidian tomorrow<cr>", desc = "New Diary Note (Tomorrow)" },
      { "<leader>Wdn", "<cmd>Obsidian today<cr>", desc = "New Diary Note (Today)" },
      { "<leader>Wdy", "<cmd>Obsidian yesterday<cr>", desc = "New Diary Note (Yesterday)" },

      { "<leader>Wn", desc = "Note" },
      { "<leader>Wnb", "<cmd>Obsidian backlinks<cr>", desc = "Backlinks" },
      { "<leader>Wnl", "<cmd>Obsidian links<cr>", desc = "Links" },
      { "<leader>Wnr", "<cmd>Obsidian rename<cr>", desc = "Rename" },
      { "<leader>Wnt", "<cmd>Obsidian toc<cr>", desc = "TOC" },
    },
  },
  {
    "eckii24/m_taskwarrior_d.nvim",
    branch = "dev",
    dependencies = { "MunifTanjim/nui.nvim" },
    ft = { "markdown" },
    opts = {
      list_pattern = {
        lua = "%*",
        vim = "\\*",
      },
      default_list_symbol = "*",
      display_due_or_scheduled = false,
    },
    keys = {
      { "<leader>te", "<cmd>TWEditTask<cr>", desc = "TaskWarrior Edit" },
      { "<leader>tr", "<cmd>TWRunWithCurrent<cr>", desc = "TaskWarrior Run with Current" },
      { "<leader>td", "<cmd>TWRunWithCurrent done<cr>", desc = "TaskWarrior Run with Current" },
      { "<leader>tD", "<cmd>TWRunWithCurrent mod status:pending<cr>", desc = "TaskWarrior Run with Current" },
      { "<leader>tt", "<cmd>TWToggle<cr>", desc = "TaskWarrior Toggle" },
      { "<leader>ti", "<cmd>TWView<cr>", desc = "TaskWarrior View" },
      { "<leader>tu", "<cmd>TWUpdateCurrent<cr>", desc = "TaskWarrior Update Current" },
      { "<leader>ts", "<cmd>TWSyncTasks<cr>", desc = "TaskWarrior Sync Tasks" },
    },
    init = function()
      vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost" }, {
        group = vim.api.nvim_create_augroup("TWTask", { clear = true }),
        pattern = { "*.md", "*.markdown" },
        callback = function()
          require("lazy").load({ plugins = { "m_taskwarrior_d.nvim" } })
          vim.cmd("TWSyncTasks")
        end,
      })
    end,
  },
  {
    "MeanderingProgrammer/render-markdown.nvim",
    dependencies = { "nvim-treesitter/nvim-treesitter" },
    opts = {
      checkbox = {
        enabled = true,
        custom = {
          started = { raw = "[>]", rendered = " ", highlight = "@markup.raw" },
          deleted = { raw = "[~]", rendered = " ", highlight = "@markup.raw" },
        },
      },
    },
  },
}
