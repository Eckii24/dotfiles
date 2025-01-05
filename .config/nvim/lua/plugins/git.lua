return {
  {
    "lewis6991/gitsigns.nvim",
    keys = {
      {
        "<leader>h", "", desc = "+hunks",
      },
      {
        "<leader>hb",
        "<cmd>Gitsigns blame_line<cr>",
        desc = "Blame Line"
      },
      {
        "<leader>hB",
        "<cmd>Gitsigns blame<cr>",
        desc = "Blame Buffer"
      },
      {
        "<leader>hs",
        "<cmd>Gitsigns stage_hunk<cr>",
        desc = "Stage Hunk"
      },
      {
        "<leader>hS",
        "<cmd>Gitsigns stage_buffer<cr>",
        desc = "Stage Buffer"
      },
      {
        "<leader>hr",
        "<cmd>Gitsigns reset_hunk<cr>",
        desc = "Reset Hunk"
      },
      {
        "<leader>hR",
        "<cmd>Gitsigns reset_buffer<cr>",
        desc = "Reset Buffer"
      },
      {
        "<leader>hu",
        "<cmd>Gitsigns undo_stage_hunk<cr>",
        desc = "Undo Stage Hunk"
      },
      {
        "<leader>hp",
        "<cmd>Gitsigns preview_hunk_inline<cr>",
        desc = "Preview Hunk Inline"
      },
    },
  },
  {
    "akinsho/git-conflict.nvim",
    lazy = false,
    opts = {
      default_mappings = {
        ours = "<leader>ho",
        theirs = "<leader>ht",
        none = "<leader>h0",
        both = "<leader>hb",
        next = "]x",
        prev = "[x",
      },
    },
    keys = {
      {
        "<leader>gx",
        "<cmd>GitConflictListQf<cr>",
        desc = "List Conflicts"
      },
      {
        "<leader>gr",
        "<cmd>GitConflictRefresh<cr>",
        desc = "Refresh Conflicts"
      },
    },
  },
}
