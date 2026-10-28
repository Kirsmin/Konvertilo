<script setup lang="ts">
import { computed } from 'vue'
import type { ConverterConfig, Task } from '../types'
import { getEncodersForTarget, qualitiesForEncoder } from '../config/converters'
import {
  isLosslessVideoEncoder,
  isQualityApplicable,
  usesQscale,
} from '../utils/ffmpegArgs'
import { useTasksStore } from '../stores/tasks'
import MiniSelect from './MiniSelect.vue'
import SelectRow from './SelectRow.vue'

const props = defineProps<{
  task: Task
  converter: ConverterConfig
  selected: boolean
}>()

const emit = defineEmits<{
  toggle: []
  retry: []
}>()

const tasksStore = useTasksStore()
const encoderOptions = computed(() =>
  getEncodersForTarget(props.converter, props.task.targetFormat),
)

// 该编码器不吃 CRF / 码率时，质量只作为静态文本展示
const qualityApplicable = computed(() =>
  isQualityApplicable(
    props.converter,
    props.task.targetFormat,
    props.task.encoder,
  ),
)

const QUALITY_TOP_HINT = '↑ 质量最好 / 体积最大'
const ENCODER_TOP_HINT = '↑ 推荐 / 兼容性优先'

const ENCODER_HINTS: Record<string, string> = {
  libmp3lame: '[推荐] 兼容性好',
  aac: '[推荐] 兼容性好 · 码率为目标值',
  alac: '无损 · 苹果生态',
  ac3: '兼容性好',
  ac3_fixed: '兼容性好',
  libvorbis: '性能强',
  flac: '无损 · 兼容性好',
  pcm_s16le: '无损 · 兼容性好',
  pcm_s24le: '无损 · 高解析',
  pcm_s32le: '无损 · 高解析',
  pcm_f32le: '无损 · 高解析',
  pcm_f64le: '无损 · 高解析',
  pcm_alaw: '语音压缩',
  pcm_mulaw: '语音压缩',
  pcm_u8: '兼容性好',
  wmav1: '兼容性好',
  wmav2: '[推荐] 兼容性好',
  libx264: '[推荐] 兼容性好',
  mpeg4: '兼容性好',
  mpeg2video: '兼容性好',
  mpeg1video: '兼容性好 · 输出 25fps',
  libvpx: '兼容性好',
  ffv1: '无损 · 体积大',
  prores_ks: '专业剪辑',
  prores_aw: '专业剪辑',
  prores: '专业剪辑',
  gif: '动图',
  huffyuv: '无损 · 体积大',
  utvideo: '无损 · 剪辑友好',
  qtrle: '无损 · 动画友好',
  png: '无损 · 体积大',
  rawvideo: '无压缩 · 体积最大',
  msmpeg4v2: '兼容性好',
  msmpeg4: '兼容性好',
  wmv2: '兼容性好',
}

const isCrfQuality = computed(() =>
  props.converter.qualities.some((quality) => quality.startsWith('CRF ')),
)

// 音频码率越大越好，因此倒序展示；CRF 数值越小越好，保持 0 在最上方
const qualityOptions = computed(() => {
  // 质量档位按编码器约束过滤：音频看最低码率（libvorbis 双声道 48k、wma 24k），
  // 视频看 CRF 下限（libvpx 最低 4）
  const options = [...qualitiesForEncoder(props.converter, props.task.encoder)]
  return isCrfQuality.value ? options : options.reverse()
})

function bitrateHint(kbps: number) {
  if (kbps === 192) return 'CD'
  if (kbps === 128) return '标准'
  if (kbps === 112) return '普通'
  if (kbps === 80 || kbps === 64) return '语音'
  if (kbps === 24 || kbps === 16) return '电话'
  return ''
}

function crfHint(crf: number) {
  if (crf <= 0) return '无损 / 体积最大'
  if (crf <= 10) return '接近无损'
  if (crf <= 16) return '极高质量'
  if (crf <= 19) return '极高质量'
  if (crf <= 23) return '高质量 / 推荐'
  if (crf <= 26) return '较好质量'
  if (crf <= 29) return '标准质量'
  if (crf <= 33) return '较小体积'
  if (crf <= 38) return '低质量'
  if (crf <= 45) return '很低质量'
  return '体积最小 / 质量最低'
}

function qualityHint(option: string) {
  if (option.endsWith('k')) {
    return bitrateHint(Number.parseInt(option, 10))
  }
  if (option.startsWith('CRF ')) {
    return crfHint(Number.parseInt(option.slice(4), 10))
  }
  return ''
}

const qualityHints = computed(() =>
  Object.fromEntries(
    qualityOptions.value.map((option) => [option, qualityHint(option)]),
  ),
)

// 体积预警：无损编码器与 GIF 的产物常比源文件大一个量级，转完才发现就晚了
const sizeWarning = computed(() => {
  if (props.converter.to !== 'Video') return ''
  if (props.task.targetFormat === 'GIF') {
    return 'GIF 固定 12fps、最宽 480 像素（小素材不放大），体积通常是源文件的数倍'
  }
  if (isLosslessVideoEncoder(props.task.encoder)) {
    return `${props.task.encoder} 是无损编码，产物可能有源文件的数倍到数十倍大`
  }
  return ''
})

const qualityTitle = computed(() =>
  usesQscale(props.task.encoder)
    ? '目标质量（该编码器按 Q 值 1-31 生效，已按档位换算）'
    : '目标质量',
)

function onNameBlur(event: FocusEvent) {
  const element = event.currentTarget as HTMLElement
  const value = (element.textContent ?? '').trim()
  // 一律写回 store：空输入回落默认名，非法字符在 store 内净化，
  // 再用 store 里的结果回显，避免「界面显示 A、状态里是 B」。
  tasksStore.renameOutput(props.task.id, value)
  element.textContent = props.task.outputName
}
</script>

<template>
  <SelectRow :selected="selected" @toggle="emit('toggle')">
    <div class="line1">
      <span v-if="task.error" class="errbadge" :title="task.error">✗</span>
      <span class="fname">{{ task.name }}</span>
      <span class="mmeta">
        <span class="fmt">{{ task.format }}</span>
        <span class="size">{{ task.sizeLabel }}</span>
        <span class="size">{{ task.duration }}</span>
      </span>
      <button
        type="button"
        class="btn rowx actionable"
        title="取消任务"
        @click="tasksStore.remove(task.id)"
      >
        ✗
      </button>
    </div>

    <div class="line2">
      -&gt;
      <MiniSelect
        :model-value="task.targetFormat"
        :options="converter.targetFormats"
        title="目标格式"
        @change="tasksStore.updateTargetFormat(task.id, $event)"
      />
      <span v-if="qualityApplicable">
        质量
        <MiniSelect
          :model-value="task.quality"
          :options="qualityOptions"
          :title="qualityTitle"
          :top-hint="QUALITY_TOP_HINT"
          :option-hints="qualityHints"
          @change="tasksStore.updateQuality(task.id, $event)"
        />
      </span>
      <span v-else class="quality-fixed">质量 不适用</span>
      <span v-if="encoderOptions.length > 1" class="encoder-select">
        编码器
        <MiniSelect
          :model-value="task.encoder"
          :options="encoderOptions"
          title="目标编码器"
          :top-hint="ENCODER_TOP_HINT"
          :option-hints="ENCODER_HINTS"
          @change="tasksStore.updateEncoder(task.id, $event)"
        />
      </span>
      <span v-else class="encoder-fixed">
        编码器 {{ task.encoder }}
      </span>
      <button
        v-if="task.error"
        type="button"
        class="btn actionable retry"
        title="重新转换这一条"
        @click="emit('retry')"
      >
        重试
      </button>
      <span>
        输出
        <span
          class="oname"
          contenteditable="true"
          tabindex="0"
          role="textbox"
          aria-label="输出文件名，可直接编辑"
          spellcheck="false"
          title="点击基于原名修改"
          @blur="onNameBlur"
          @keydown.enter.prevent="($event.target as HTMLElement).blur()"
          @keydown.esc.prevent="($event.target as HTMLElement).blur()"
          v-text="task.outputName"
        ></span>
      </span>
    </div>

    <p v-if="task.error" class="rowerr">{{ task.error }}</p>
    <p v-if="sizeWarning && !task.error" class="rowwarn">{{ sizeWarning }}</p>
  </SelectRow>
</template>

<style scoped>
.line1 {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}

.mmeta {
  display: contents;
}

.fname {
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmt {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.5px;
}

.size {
  color: var(--muted);
  font-size: 12px;
}

.rowx {
  color: var(--muted);
}

.line2 {
  color: var(--muted);
  font-size: 12px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 2px;
}

.encoder-fixed {
  white-space: nowrap;
}

.quality-fixed {
  white-space: nowrap;
}

.errbadge {
  color: var(--err);
  font-weight: 600;
}

.retry {
  color: var(--err);
}

.rowerr,
.rowwarn {
  font-size: 11px;
  margin-top: 3px;
  overflow-wrap: anywhere;
}

.rowerr {
  color: var(--err);
}

.rowwarn {
  color: var(--warn);
}

.oname {
  border-bottom: 1px dashed var(--dash);
  cursor: text;
  outline: none;
  color: var(--ink);
}

.oname:focus {
  border-bottom-style: solid;
  color: var(--accent);
}

@media (min-width: 721px) {
  .fname {
    max-width: 42ch;
  }

  .fmt {
    font-size: 12px;
  }

  .size {
    font-size: 13px;
  }

  .line2 {
    gap: 12px;
    font-size: 14px;
  }
}

@media (max-width: 720px) {
  .line1 {
    padding-right: 26px;
  }

  .line1 .fname {
    flex: 1 1 100%;
    max-width: none;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .rowx {
    position: absolute;
    top: 12px;
    right: 4px;
  }

  .line1 .mmeta {
    flex: 1 1 100%;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .oname {
    user-select: text;
    -webkit-user-select: text;
    overflow-wrap: anywhere;
  }

  .line2 {
    gap: 6px 12px;
  }
}
</style>
