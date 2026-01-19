import Pipeline
def process_query(query: str, usr_id: str):
    res = Pipeline.main(query, usr_id)
    return res
