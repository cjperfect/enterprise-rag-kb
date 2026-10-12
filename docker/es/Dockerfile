# Elasticsearch 本地开发镜像 —— 官方 8.13.4 + 官方 smartcn 中文分析插件
#
# 说明：原计划装 IK 分词器，但 infinilabs/analysis-ik 的 GitHub release 已无
# 可直接下载的 zip（且 GitHub 下载通道不稳），故改用 Elastic 官方中文插件
# analysis-smartcn（artifacts.elastic.co 可达、版本精确匹配）。
# smartcn 基于词典 + bigram 兜底，中文检索效果介于 standard 与 IK 之间；
# 后续若拿到可用的 IK 插件包，只需替换此处安装源。
#
# 本地开发用途：关闭安全认证（xpack.security.enabled=false），
# 单节点 discovery，JVM 堆限制 256m 省内存（生产环境请按数据量调大）。
FROM docker.elastic.co/elasticsearch/elasticsearch:8.13.4

# 安装官方中文分析插件（版本必须与 ES 版本一致）
RUN bin/elasticsearch-plugin install --batch \
    https://artifacts.elastic.co/downloads/elasticsearch-plugins/analysis-smartcn/analysis-smartcn-8.13.4.zip
