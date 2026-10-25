<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useHistoryStore } from '../stores/history'
import { absoluteTime, relativeTime } from '../utils/format'

const historyStore = useHistoryStore()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

const entries = computed(() =>
  [...historyStore.entries].sort((a, b) => b.id - a.id),
)

function toggleTime(id: number) {
  historyStore.toggleShowAbs(id)
}

function removeEntry(id: number) {
  historyStore.remove(id)
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<template>
  <div class="popover" role="dialog" aria-label="历史记录" @click.stop>
    <p v-if="historyStore.storageBlocked" class="hnote">
      浏览器存储空间不足，历史只保留本次会话中的记录
    </p>
    <ul v-if="entries.length">
      <li v-for="(entry, index) in entries" :key="entry.id" class="hentry">
        <div class="hhead">
          <span>#{{ index + 1 }}</span>
          <button
            type="button"
            class="btn"
            title="切换绝对 / 相对时间"
            @click="toggleTime(entry.id)"
          >
            {{ entry.showAbs ? absoluteTime(entry.ts) : relativeTime(entry.ts, now) }}
          </button>
        </div>
        <div class="hline">
          <span class="fname">{{ entry.inName }}</span>
          <span class="fmt">{{ entry.inFmt }}</span>
        </div>
        <div class="hline">
          -&gt;
          <span class="fname">{{ entry.outName }}</span>
          <span class="fmt">{{ entry.outFmt }}</span>
        </div>
        <div class="hmeta">
          <span>{{ entry.dur }}</span>
          <span>{{ entry.from }}-&gt;{{ entry.to }}</span>
          <button
            type="button"
            class="btn"
            title="移除该记录"
            @click="removeEntry(entry.id)"
          >
            ✗
          </button>
        </div>
      </li>
    </ul>
    <div v-else class="hempty">暂无记录</div>
  </div>
</template>

<style scoped>
.popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: min(370px, 86vw);
  background: var(--card);
  border: 1px solid var(--line);
  padding: 10px 14px;
  z-index: 60;
  text-align: left;
}

.popover ul {
  list-style: none;
  max-height: 50vh;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--dash) transparent;
}

.popover ul::-webkit-scrollbar {
  width: 6px;
}

.popover ul::-webkit-scrollbar-thumb {
  background: var(--dash);
  border-radius: 0;
}

.popover ul::-webkit-scrollbar-track {
  background: transparent;
}

.hentry {
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
}

.hentry:last-child {
  border: 0;
}

.hhead {
  display: flex;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  align-items: baseline;
}

.hline {
  font-size: 13px;
}

.fname {
  display: inline-block;
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.fmt {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.5px;
}

.hmeta {
  color: var(--muted);
  font-size: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.hnote {
  margin: 0 0 6px;
  padding: 4px 6px;
  color: var(--err);
  font-size: 12px;
  border-left: 1px solid var(--err);
}

.hempty {
  padding: 10px 0;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

@media (min-width: 721px) {
  .popover {
    width: min(430px, 86vw);
    padding: 12px 16px;
  }

  .popover ul {
    max-height: 56vh;
  }

  .hentry {
    padding: 10px 0;
  }

  .hhead {
    font-size: 13px;
  }

  .hline {
    font-size: 15px;
  }

  .fname {
    max-width: 38ch;
  }

  .fmt {
    font-size: 12px;
  }

  .hmeta {
    font-size: 13px;
  }

  .hempty {
    font-size: 14px;
  }
}

@media (max-width: 720px) {
  .popover {
    width: calc(100vw - 44px);
    right: 0;
  }

  .popover ul {
    max-height: 45vh;
  }

  .fname {
    max-width: none;
    white-space: normal;
    overflow: visible;
    overflow-wrap: anywhere;
  }
}
</style>
