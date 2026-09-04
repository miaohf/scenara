ComfyUI 工作流 JSON 已迁移至后端单一数据源：

`back-end/workflows/`

前端通过 `GET /api/v1/ai/workflows/{name}` 加载模板（需登录）。
请将新的工作流文件放入 `back-end/workflows/`，并在模型配置中填写对应的 `workflowName`。

Export the workflow from ComfyUI using **API Format JSON**.
