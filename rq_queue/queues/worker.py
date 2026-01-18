
import Pipeline
async def process_query(query:str,usr_id):
    res = list(Pipeline.main(query,usr_id))
    return res

