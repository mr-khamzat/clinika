from fastapi import APIRouter
router = APIRouter(prefix="/sample", tags=["sample"])


@router.get("/items")
async def list_items():
    ...


@router.post("/items")
async def create_item():
    ...


@router.delete("/items/{item_id}")
async def delete_item(item_id: int):
    ...


# Закомментированный — не должен попасть в результат
# @router.put("/items/{item_id}")
