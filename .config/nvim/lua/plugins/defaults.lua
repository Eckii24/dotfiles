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
      search = {
        mode = "fuzzy",
      },
      modes = {
        search = {
          enabled = true,
        },
        char = {
          jump_labels = true
        }
      }
    }
  }
}
