<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="privacy-page">
    <section class="card">
      <header class="page-head">
        <h1><span class="mark">∮</span> 使用条款</h1>
        <RouterLink class="btn back" to="/">← 返回转换器</RouterLink>
      </header>

      <div class="content">
        <ol class="terms">
          <li>
            <p>
              本站核心源码已开源，允许自由使用、二次创作、部署。公开部署请在「关于」页注明原作者；
            </p>
          </li>
          <li>
            <p>所有文件均在本地处理，无使用限制；</p>
          </li>
          <li>
            <p>本站会收集一些信息用于分析和改进功能，包括：</p>
            <ul class="collect-list">
              <li>1) 你的 IP 地址</li>
              <li>2) 浏览器类型</li>
              <li>3) 在引擎报错时自动回传错误信息</li>
              <li>
                4) 每次任务完成后，回传文件尺寸、编码器、转换参数、处理时间用于分析性能。数据不涉及文件内容、不会上传文件
              </li>
            </ul>
          </li>
          <li>
            <p>收集的数据仅用于内部分析，不会共享给任何第三方</p>
          </li>
        </ol>
      </div>

      <footer>
        <span>∮ 转换器<sup>0.1</sup></span>
        <span>·</span>
        <span>Kirsmin 作品</span>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.privacy-page {
  min-height: 100vh;
}

.card {
  max-width: 920px;
  margin: 28px auto;
  padding: 22px 26px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0;
  box-shadow: none;
}

.page-head {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

h1 {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 15px;
  font-weight: 400;
  letter-spacing: 0.5px;
}

.mark {
  color: var(--ink);
}

.back {
  color: var(--muted);
  white-space: nowrap;
}

.content {
  padding: 4px 0 8px;
}

.terms {
  list-style: none;
  counter-reset: terms;
}

.terms > li {
  counter-increment: terms;
  padding: 10px 0;
  border-bottom: 1px dashed var(--line);
}

.terms > li:last-child {
  border-bottom: 0;
}

.terms > li::before {
  content: counter(terms) '.';
  float: left;
  width: 2.2em;
  color: var(--muted);
}

.terms p {
  overflow: hidden;
}

.collect-list {
  list-style: none;
  margin-top: 4px;
  padding-left: 2.2em;
  color: var(--muted);
}

.collect-list li {
  padding: 2px 0;
}

footer {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

footer sup {
  font-size: 9px;
}

@media (min-width: 1024px) {
  .card {
    max-width: 1080px;
    margin: 36px auto;
    padding: 28px 34px;
  }

  h1 {
    font-size: 20px;
  }

  .terms > li {
    padding: 12px 0;
  }

  footer {
    margin-top: 22px;
    padding-top: 14px;
    font-size: 13px;
  }

  footer sup {
    font-size: 10px;
  }
}

@media (max-width: 720px) {
  .card {
    margin: 10px;
    padding: 14px 12px;
  }
}
</style>
